import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '@prisma/client';
import { JwtPayload } from './interfaces/jwt.interface';
import { JwtService } from '@nestjs/jwt';
import * as ms from 'ms';
import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import { isDev } from '../../common/utils/is-dev';
import { hash, verify } from 'argon2';
import { LoginDto } from './dto/login.dto';
import { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  private readonly JWT_ACCESS_TOKEN_TTL: StringValue;
  private readonly JWT_REFRESH_TOKEN_TTL: StringValue;
  private readonly COOKIES_DOMAIN: string;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.JWT_ACCESS_TOKEN_TTL = this.configService.getOrThrow(
      'JWT_ACCESS_TOKEN_TTL',
    );
    this.JWT_REFRESH_TOKEN_TTL = this.configService.getOrThrow(
      'JWT_REFRESH_TOKEN_TTL',
    );
    this.COOKIES_DOMAIN =
      this.configService.getOrThrow<string>('COOKIES_DOMAIN');
  }

  public async register(res: Response, dto: RegisterDto, req: Request) {
    const { login, password } = dto;

    if (!login) {
      throw new ConflictException('Логин обязателен');
    }

    const isExists = await this.prismaService.user.findUnique({
      where: { login },
    });
    if (isExists)
      throw new ConflictException(
        'Пользователь с таким логином уже существует',
      );

    const hashPassword = await hash(password);
    const user = await this.prismaService.user.create({
      data: { login, password: hashPassword },
    });
    return this.auth(res, user, req);
  }

  public async login(res: Response, dto: LoginDto, req: Request) {
    const { login, password } = dto;
    const user = await this.prismaService.user.findUnique({
      where: { login },
    });
    if (!user) throw new NotFoundException('Неверный логин или пароль');
    const isValidPassword = await verify(user.password, password);
    if (!isValidPassword)
      throw new NotFoundException('Неверный логин или пароль');
    return this.auth(res, user, req);
  }

  public async logout(res: Response, req: Request) {
    const refreshToken = (req.cookies?.['refreshToken'] as string) || null;

    if (refreshToken) {
      try {
        const payload =
          await this.jwtService.verifyAsync<JwtPayload>(refreshToken);

        if (payload?.sessionId) {
          await this.prismaService.session
            .delete({
              where: { id: payload.sessionId },
            })
            .catch(() => {
              // Игнорируем ошибку, если сессия уже удалена
            });
        }
      } catch {
        // Игнорируем ошибки валидации токена
      }
    }

    return this.setCookies(res, '', new Date(0));
  }

  public getInfo(req: Request) {
    const user = req.user;
    if (!user) {
      throw new ConflictException('Не получилось извлечь данные из request');
    }
    const { login } = user;
    return { login };
  }

  public async refresh(req: Request, res: Response) {
    if (!req || !req.cookies) {
      throw new UnauthorizedException('Не удалось получить куки');
    }

    const refreshToken = (req.cookies?.['refreshToken'] as string) || null;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token не найден');
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<JwtPayload>(refreshToken);

      if (!payload?.sessionId) {
        throw new UnauthorizedException('Невалидный refresh token');
      }

      const session = await this.prismaService.session.findUnique({
        where: { id: payload.sessionId },
        include: { user: true },
      });

      if (!session) {
        throw new UnauthorizedException('Сессия не найдена');
      }

      if (session.expiresAt < new Date()) {
        await this.prismaService.session.delete({
          where: { id: session.id },
        });
        throw new UnauthorizedException('Сессия истекла');
      }

      const isValidToken = await this.verifyRefreshToken(
        session.refreshToken,
        refreshToken,
      );

      if (!isValidToken) {
        throw new UnauthorizedException('Невалидный refresh token');
      }

      // Удаляем старую сессию (rotation)
      await this.prismaService.session.delete({
        where: { id: session.id },
      });

      // Создаем новую сессию и токены
      return this.auth(res, session.user, req);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Невалидный refresh token');
    }
  }

  private async auth(res: Response, user: User, req: Request) {
    const { accessToken, refreshToken, refreshTokenExpires, sessionId } =
      await this.generateTokens(user);
    const tokenHash = await this.hashRefreshToken(refreshToken);
    await this.prismaService.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshToken: tokenHash,
        expiresAt: refreshTokenExpires,
      },
    });
    this.setCookies(res, refreshToken, refreshTokenExpires);
    // req может использоваться в будущем для user-agent и IP адреса
    void req;
    return { accessToken };
  }

  private async generateTokens(user: User) {
    const sessionId = uuidv4();
    const accessPayload: JwtPayload = {
      id: user.id,
      sessionId, // Включаем sessionId в access token для проверки сессии
    };

    const refreshPayload: JwtPayload = {
      id: user.id,
      sessionId, // Включаем sessionId в refresh token
    };

    const refreshTokenExpires = new Date(
      Date.now() + ms(this.JWT_REFRESH_TOKEN_TTL),
    );

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      expiresIn: this.JWT_ACCESS_TOKEN_TTL,
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      expiresIn: this.JWT_REFRESH_TOKEN_TTL,
    });

    return { accessToken, refreshToken, refreshTokenExpires, sessionId };
  }

  private setCookies(res: Response, value: string, expires: Date) {
    res.cookie('refreshToken', value, {
      httpOnly: true,
      domain: this.COOKIES_DOMAIN,
      expires,
      secure: false,
      sameSite: 'lax',
    });
  }

  private async hashRefreshToken(token: string): Promise<string> {
    return await hash(token);
  }

  private async verifyRefreshToken(
    hashedToken: string,
    plainToken: string,
  ): Promise<boolean> {
    try {
      return await verify(hashedToken, plainToken);
    } catch {
      return false;
    }
  }
}
