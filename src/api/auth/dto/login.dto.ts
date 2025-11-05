import {
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'Логин обязателен' })
  @IsString({ message: 'Логин должен быть строкой' })
  @Matches(/^([\w-\.]+@([\w-]+\.)+[\w-]{2,4}|(\+7|8)[0-9]{10,11})$/, {
    message: 'Логин должен быть email или российским номером телефона (+7 или 8)',
  })
  login: string;

  @IsNotEmpty({ message: 'Пароль обязателен' })
  @IsString({ message: 'Пароль должен быть строкой' })
  password: string;
}
