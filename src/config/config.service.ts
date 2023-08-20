import { DotenvParseOutput, config } from 'dotenv';
import { IConfigService } from '../models/config.interface';

export class ConfigService implements IConfigService {
  private config: DotenvParseOutput;
  constructor() {
    const { error, parsed } = config();
    if (error) {
      throw new Error('.env file not found');
    }
    if (!parsed) {
      throw new Error('Empty .env file');
    }
    this.config = parsed;
  }
  get(key: string): string {
    const res = this.config[key];
    if (!res) {
      throw new Error('No such a key');
    }
    return res;
  }
}
