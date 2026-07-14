import type { Page } from 'playwright';

import type { OperationContract } from '../../contracts/schema';
import type { VivoContractExecutor } from './vivo-api';

export class VivoPageExecutor implements VivoContractExecutor {
  constructor(private readonly page: Page) {}

  async call<T>(operation: OperationContract, payload: unknown): Promise<T> {
    return this.page.evaluate(
      async ({ contractOperation, requestPayload }) => {
        type OfficialRequire = (moduleId: number) => Record<string, unknown>;
        type VivoWindow = Window & {
          webpackJsonp?: { push(chunk: unknown[]): void };
          __notechangeWebpackRequire?: OfficialRequire;
        };
        const vivoWindow = window as VivoWindow;

        if (!vivoWindow.__notechangeWebpackRequire) {
          if (!vivoWindow.webpackJsonp) throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');
          vivoWindow.webpackJsonp.push([
            [987654],
            {
              987654: (
                _module: unknown,
                _exports: unknown,
                require: OfficialRequire
              ) => {
                vivoWindow.__notechangeWebpackRequire = require;
              }
            },
            [[987654]]
          ]);
        }

        const require = vivoWindow.__notechangeWebpackRequire;
        if (!require) throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');

        if (contractOperation.name === 'createSync') {
          const syncModule = require(1281) as {
            createSync?: (value: unknown) => Promise<T>;
          };
          if (!syncModule.createSync) throw new Error('VIVO_CREATE_SYNC_UNAVAILABLE');
          return syncModule.createSync(requestPayload);
        }

        const requestModule = require(137) as {
          default?: {
            requestBranch?: (options: Record<string, unknown>) => Promise<T>;
          };
        };
        const requestBranch = requestModule.default?.requestBranch;
        if (!requestBranch) throw new Error('VIVO_REQUEST_BRANCH_UNAVAILABLE');
        return requestBranch({
          url: contractOperation.path,
          syncName: contractOperation.name,
          method: contractOperation.method,
          data: requestPayload,
          encrypt: contractOperation.wireBodyKeys?.includes('jvq_param') === true,
          optimize: false
        });
      },
      { contractOperation: operation, requestPayload: payload }
    );
  }
}
