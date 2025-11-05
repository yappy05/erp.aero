# ERP.AERO — запуск

В проекте есть готовый `.env`.

## Локальный запуск
```bash
npm install
docker compose up -d db
npm run prisma:push
npm run start:dev
```

## Запуск из Docker
```bash
# Запустить весь проект (app + db)
docker compose up -d --build

# Запустить только базу данных
docker compose up -d db

# Логи приложения
docker compose logs -f app

# Остановить всё
docker compose down
```

## Postman
- Коллекция: `erp.aero.postman_collection.json`
- Окружение: `dev`
- После получения accessToken обновите переменную окружения Postman `jwt` (environment `dev`).

### Эндпоинты (актуальные)
Аутентификация (`/auth`):
- POST `/auth/signup` — регистрация `{ login, password }`
- POST `/auth/signin` — вход `{ login, password }`
- POST `/auth/logout` — выход (очистка refresh-cookie)
- POST `/auth/signin/new_token` — обновление access-токена по refresh-cookie
- GET `/auth/info` — информация о текущем пользователе (Bearer `{{jwt}}`)

Файлы (`/files`, авторизация обязательна):
- POST `/files/upload` — загрузка (form-data `file`), множественная
- GET `/files/list?page=1&list_size=10` — список
- GET `/files/:id` — метаданные
- GET `/files/download/:id` — скачать
- PUT `/files/update/:id` — заменить содержимое (form-data `file`)
- DELETE `/files/delete/:id` — удалить

## Поток данных
1) Регистрация/вход: `POST /auth/signup` или `POST /auth/signin`
- Ответ: `{ accessToken }`
- В куки (httpOnly) устанавливается `refreshToken`
- Действие: в Postman окружении `dev` присвойте `jwt = accessToken`

2) Доступ к защищённым ресурсам
- Добавьте заголовок Authorization: `Bearer {{jwt}}`
- Работают эндпоинты `/files/*` и `GET /auth/info`

3) Обновление access-токена
- Когда access истёк, вызовите `POST /auth/signin/new_token`
- Читает httpOnly `refreshToken` из cookie, возвращает новый `{ accessToken }`
- Обновите `jwt` в окружении Postman новым значением

4) Выход
- `POST /auth/logout` удаляет серверную сессию и очищает refresh-cookie
