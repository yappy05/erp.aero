import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
  DefaultValuePipe,
  ParseIntPipe,
  Delete,
  Param,
  Res,
  Put,
  UploadedFile,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { Protected } from '../../common/decorators';
import { Request, Response } from 'express';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';

@Protected()
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FilesInterceptor('file', 21))
  public async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ) {
    return await this.filesService.upload(files, req);
  }

  @Get('list')
  public async getFiles(
    @Req() req: Request,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('list_size', new DefaultValuePipe(10), ParseIntPipe)
    listSize: number,
  ) {
    return await this.filesService.getFiles(req, page, listSize);
  }

  @Delete('delete/:id')
  public async deleteFile(@Param('id') fileId: string, @Req() req: Request) {
    return await this.filesService.deleteFile(fileId, req);
  }

  @Get(':id')
  public async getFile(@Param('id') fileId: string, @Req() req: Request) {
    return await this.filesService.getFile(fileId, req);
  }

  @Get('download/:id')
  public async downloadFile(
    @Param('id') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return await this.filesService.downloadFile(fileId, req, res);
  }

  @Put('update/:id')
  @UseInterceptors(FileInterceptor('file'))
  public async updateFile(
    @Param('id') fileId: string,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return await this.filesService.updateFile(file, fileId, req);
  }
}
