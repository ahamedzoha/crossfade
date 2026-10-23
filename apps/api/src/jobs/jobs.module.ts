import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';
import { WorkerService } from './worker.service.js';

@Global()
@Module({
  providers: [QueueService, WorkerService],
  exports: [QueueService, WorkerService],
})
export class JobsModule {}
