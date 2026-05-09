import { Get, JsonController } from 'routing-controllers';
import { Service } from 'typedi';

@JsonController('/health')
@Service()
export class HealthController {
  @Get('/')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
