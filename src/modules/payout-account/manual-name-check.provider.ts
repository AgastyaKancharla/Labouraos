import { Injectable } from '@nestjs/common';
import {
  NameCheckProvider,
  NameCheckResult,
} from './name-check-provider.interface';

@Injectable()
export class ManualNameCheckProvider implements NameCheckProvider {
  async checkName(): Promise<NameCheckResult> {
    return {
      checked: false,
      message: 'not checked — Finance confirms at payment',
    };
  }
}
