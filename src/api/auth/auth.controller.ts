import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { Response, Request } from 'express';
import { LoginDto } from './dto/login.dto';
import { Protected } from '../../common/decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Protected()
  @Get()
  public findAll() {
    return this.authService.getAll();
  }

  @Post('signup')
  public async create(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RegisterDto,
  ) {
    return await this.authService.register(res, dto);
  }

  @Post('signin')
  public async login(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    return await this.authService.login(res, dto);
  }

  @Post('logout')
  public logout(
    @Res({ passthrough: true }) res: Response
  ) {
    return this.authService.logout(res);
  }

  @Post('signin/refresh')
  public async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return await this.authService.refresh(req, res);
  }

  @Protected()
  @Get('info')
  public info(@Req() req: Request) {
    return this.authService.getInfo(req);
  }
}
