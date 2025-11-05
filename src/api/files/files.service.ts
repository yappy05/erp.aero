import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Request, Response } from 'express';
import * as process from 'node:process';
import { join } from 'node:path';
import { existsSync } from 'fs';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';

@Injectable()
export class FilesService {
  private readonly uploadPath = join(process.cwd(), 'src', 'store');
  private readonly maxFileSize = 100 * 1024 * 1024;

  constructor(private readonly prismaService: PrismaService) {
    this.ensureUploadDirectory();
  }

  public async upload(files: Express.Multer.File[], req: Request) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Файлы не были загружены');
    }

    const user = req.user;
    if (!user) {
      throw new ConflictException('Не получилось извлечь данные из request');
    }
    const { id: userId, login } = user;

    const userFolderPath = join(this.uploadPath, login);
    await mkdir(userFolderPath, { recursive: true });

    // Обрабатываем каждый файл
    const savedFiles = await Promise.all(
      files.map(async (file) => {
        // Проверка размера каждого файла
        if (file.size > this.maxFileSize) {
          throw new BadRequestException(
            `Файл ${file.originalname} превышает максимальный размер (${this.maxFileSize / 1024 / 1024} МБ)`,
          );
        }

        const fileId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const extension =
          file.originalname.split('.').pop()?.toLowerCase() || '';
        const fileName = extension ? `${fileId}.${extension}` : fileId;
        const filePath = join(userFolderPath, fileName);

        await writeFile(filePath, file.buffer);

        const title = file.originalname.replace(/\.[^/.]+$/, '');

        const savedFile = await this.prismaService.files.create({
          data: {
            userId,
            title,
            extension: extension || '',
            mimeType: file.mimetype || 'application/octet-stream',
            sizeBytes: file.size,
            filePath: fileName,
          },
        });

        return {
          id: savedFile.id,
          title: savedFile.title,
          extension: savedFile.extension,
          mimeType: savedFile.mimeType,
          sizeBytes: savedFile.sizeBytes,
          createdAt: savedFile.createdAt,
        };
      }),
    );

    return savedFiles; // Возвращаем массив загруженных файлов
  }

  public async getFiles(req: Request, page: number, listSize: number) {
    const user = req.user;
    if (!user) {
      throw new ConflictException('Не получилось извлечь данные из request');
    }
    const { id: userId } = user;

    const skip = (page - 1) * listSize;

    const files = await this.prismaService.files.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: listSize,
    });

    const total = await this.prismaService.files.count({
      where: { userId },
    });
    const totalPages = Math.ceil(total / listSize);

    return {
      data: files,
      meta: {
        page,
        list_size: listSize,
        total,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    };
  }

  public async deleteFile(fileId: string, req: Request) {
    const user = req.user;
    if (!user) {
      throw new ConflictException('Не получилось извлечь данные из request');
    }
    const { login } = user;

    const file = await this.prismaService.files.findFirst({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException('Файл не найден');
    }

    const userFolderPath = join(this.uploadPath, login);
    const filePath = join(userFolderPath, file.filePath);

    if (existsSync(filePath)) {
      try {
        await unlink(filePath);
      } catch (e) {
        console.log(`Файл не найден на диске: ${filePath}`, e);
      }
    }

    await this.prismaService.files.delete({
      where: { id: fileId },
    });

    return {
      message: 'Файл успешно удалён',
      id: file.id,
      title: file.title,
    };
  }

  public async getFile(fileId: string, req: Request) {
    const user = req.user;
    if (!user) {
      throw new ConflictException('Не получилось извлечь данные из request');
    }

    const file = await this.prismaService.files.findFirst({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException('Файл не найден');
    }

    return file;
  }

  public async downloadFile(fileId: string, req: Request, res: Response) {
    const user = req.user;
    if (!user) {
      throw new ConflictException('Не получилось извлечь данные из request');
    }
    const { login } = user;

    const file = await this.prismaService.files.findFirst({
      where: {
        id: fileId,
      },
    });

    if (!file) {
      throw new NotFoundException('Файл не найден');
    }

    const userFolderPath = join(this.uploadPath, login);
    const filePath = join(userFolderPath, file.filePath);

    if (!existsSync(filePath)) {
      throw new NotFoundException('Файл не найден на диске');
    }

    const fileBuffer = await readFile(filePath);

    const downloadFileName = file.extension
      ? `${file.title}.${file.extension}`
      : file.title;

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(downloadFileName)}"`,
    );
    res.setHeader('Content-Length', file.sizeBytes);

    res.send(fileBuffer);
  }

  public async updateFile(
    file: Express.Multer.File,
    fileId: string,
    req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Файл не был загружен');
    }

    const user = req.user;
    if (!user) {
      throw new ConflictException('Не получилось извлечь данные из request');
    }
    const { id: userId, login } = user;

    // Проверяем размер файла
    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `Файл ${file.originalname} превышает максимальный размер (${this.maxFileSize / 1024 / 1024} МБ)`,
      );
    }

    // Находим файл и проверяем права доступа
    const currentFile = await this.prismaService.files.findFirst({
      where: { id: fileId, userId },
    });

    if (!currentFile) {
      throw new NotFoundException('Файл не найден');
    }

    const extension = file.originalname.split('.').pop()?.toLowerCase() || '';
    const fileName = extension ? `${fileId}.${extension}` : fileId;

    const userFolderPath = join(this.uploadPath, login);
    await mkdir(userFolderPath, { recursive: true });

    const filePath = join(userFolderPath, fileName);
    const currentFilePath = join(userFolderPath, currentFile.filePath);

    // Удаляем старый файл, если он существует и отличается от нового
    if (currentFile.filePath !== fileName && existsSync(currentFilePath)) {
      try {
        await unlink(currentFilePath);
      } catch (e) {
        console.error(
          `Ошибка при удалении старого файла: ${currentFilePath}`,
          e,
        );
      }
    }

    // Сохраняем новый файл
    await writeFile(filePath, file.buffer);

    // Обновляем запись в БД
    const updatedFile = await this.prismaService.files.update({
      where: { id: fileId },
      data: {
        title: file.originalname.replace(/\.[^/.]+$/, ''),
        extension: extension || '',
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        filePath: fileName,
      },
    });

    return {
      id: updatedFile.id,
      title: updatedFile.title,
      extension: updatedFile.extension,
      mimeType: updatedFile.mimeType,
      sizeBytes: updatedFile.sizeBytes,
      createdAt: updatedFile.createdAt,
    };
  }

  private async ensureUploadDirectory() {
    if (!existsSync(this.uploadPath)) {
      await mkdir(this.uploadPath, { recursive: true });
    }
  }
}
