import { JwtGuard } from '../guards';
import { UseGuards } from '@nestjs/common';

export const Protected = () => UseGuards(JwtGuard);
