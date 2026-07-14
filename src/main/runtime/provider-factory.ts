import type { Page } from 'playwright';

import vivoContractJson from '../../../docs/research/contracts/vivo-notes.contract.json';
import xiaomiContractJson from '../../../docs/research/contracts/xiaomi-notes.contract.json';
import type { CloudProvider } from '../../shared/ipc';
import { parseProviderContract } from '../contracts/loader';
import type { NotesProvider } from '../providers/provider';
import { VivoApi } from '../providers/vivo/vivo-api';
import { VivoPageExecutor } from '../providers/vivo/vivo-page-executor';
import { VivoProvider } from '../providers/vivo/vivo-provider';
import { XiaomiApi } from '../providers/xiaomi/xiaomi-api';
import { XiaomiPageExecutor } from '../providers/xiaomi/xiaomi-page-executor';
import { XiaomiProvider } from '../providers/xiaomi/xiaomi-provider';

const xiaomiContract = parseProviderContract(xiaomiContractJson);
const vivoContract = parseProviderContract(vivoContractJson);

export function createProvider(provider: CloudProvider, page: Page): NotesProvider {
  if (provider === 'xiaomi') {
    return new XiaomiProvider(new XiaomiApi(new XiaomiPageExecutor(page), xiaomiContract));
  }
  return new VivoProvider(new VivoApi(new VivoPageExecutor(page), vivoContract));
}
