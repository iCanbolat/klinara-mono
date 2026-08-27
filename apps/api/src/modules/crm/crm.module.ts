import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  controllers: [CrmController, NotesController],
  providers: [CrmService, NotesService],
  exports: [CrmService, NotesService],
})
export class CrmModule {}
