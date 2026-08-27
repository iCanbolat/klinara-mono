import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalUploadController } from './local-upload.controller';
import { FilesService } from './files.service';
import { ThumbnailWorker } from './thumbnail.worker';

@Module({
  controllers: [FilesController, LocalUploadController],
  providers: [FilesService, ThumbnailWorker],
  exports: [FilesService],
})
export class FilesModule {}
