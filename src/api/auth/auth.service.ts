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

  public async register(res: Response, dto: RegisterDto) {
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
    return this.auth(res, user);
  }

  public async login(res: Response, dto: LoginDto) {
    const { login, password } = dto;
    const user = await this.prismaService.user.findUnique({
      where: { login },
    });
    if (!user) throw new NotFoundException('Неверный логин или пароль');
    const isValidPassword = await verify(user.password, password);
    if (!isValidPassword)
      throw new NotFoundException('Неверный логин или пароль');
    return this.auth(res, user);
  }

  public logout(res: Response) {
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

  public async getAll() {
    return this.prismaService.user.findMany();
  }

  public async refresh(req: Request, res: Response) {
    if (!req || !req.cookies)
      throw new UnauthorizedException('Не удалось получить куки');
    const refreshToken = req.cookies['refreshToken'] as string;
    if (refreshToken) {
      const payload: JwtPayload =
        await this.jwtService.verifyAsync<JwtPayload>(refreshToken);
      if (payload) {
        const user = await this.prismaService.user.findUnique({
          where: { id: payload.id },
        });
        if (user) {
          return this.auth(res, user);
        } else {
          throw new UnauthorizedException('Токен был отозван');
        }
      }
    }
  }

  private async auth(res: Response, user: User) {
    const { accessToken, refreshToken, refreshTokenExpires } =
      await this.generateTokens(user);
    this.setCookies(res, refreshToken, refreshTokenExpires);
    return { accessToken };
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      id: user.id,
    };
    const refreshTokenExpires = new Date(
      Date.now() + ms(this.JWT_REFRESH_TOKEN_TTL),
    );

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.JWT_ACCESS_TOKEN_TTL,
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.JWT_REFRESH_TOKEN_TTL,
    });

    return { accessToken, refreshToken, refreshTokenExpires };
  }

  private setCookies(res: Response, value: string, expires: Date) {
    res.cookie('refreshToken', value, {
      httpOnly: true,
      domain: this.COOKIES_DOMAIN,
      expires,
      secure: !isDev(this.configService),
      sameSite: 'lax',
    });
  }
}
