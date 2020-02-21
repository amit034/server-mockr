import MarkdownIt from "markdown-it";

import { ExpectationConfigBuilder } from "./builders/expectation";
import { ResponseConfigBuilder } from "./builders/response";
import { Config } from "./Config";
import { ContextMatcherInput, ExpectationRequestContext } from "./Expectation";
import {
  ExpectationManager,
  ExpectationManagerRequestContext
} from "./ExpectationManager";
import { Logger } from "./Logger";
import { ScenarioRequestLog } from "./RequestLogManager";
import { RespondAction } from "./response-actions";
import { clone } from "./utils/clone";
import { createDefaultedState } from "./valueHelpers";
import {
  GlobalsValue,
  JSONSchemaParam,
  RequestValue,
  ResponseValue,
  StateValue
} from "./Values";

export interface ScenarioRequestContext {
  scenarioRequestLogs: ScenarioRequestLog[];
  request: RequestValue;
  response: ResponseValue;
}

interface OnBootstrapScenarioContext {
  globals: GlobalsValue;
  req: RequestValue;
  res: ResponseValue;
  state: StateValue;
}

interface OnStartScenarioContext {
  globals: GlobalsValue;
  state: StateValue;
  when: (...matchers: ContextMatcherInput[]) => ExpectationConfigBuilder;
}

export interface ScenarioConfig {
  stateParams: JSONSchemaParam[];
  description: string;
  expectationBuilders: ExpectationConfigBuilder[];
  id: string;
  onBootstrap?: OnBootstrapCallback;
  onStart?: OnStartCallback;
  tags: string[];
}

export type OnBootstrapCallback = (
  ctx: OnBootstrapScenarioContext
) => ResponseConfigBuilder | void;
export type OnStartCallback = (ctx: OnStartScenarioContext) => void;

const md = new MarkdownIt({
  html: true
});

export class Scenario {
  private active = false;
  private expectationManager?: ExpectationManager;

  constructor(private config: Config, private logger: Logger, private scenarioConfig: ScenarioConfig) {}

  async start(state?: StateValue) {
    this.active = true;

    const expectationManager = new ExpectationManager(
      this.config,
      this.logger,
      this.scenarioConfig.expectationBuilders
    );

    this.expectationManager = expectationManager;

    const { stateParams, onStart } = this.scenarioConfig;

    const defaultedState = createDefaultedState(state, stateParams);

    if (onStart) {
      const ctx: OnStartScenarioContext = {
        globals: this.config.globals,
        state: defaultedState,
        when: (...matchers: ContextMatcherInput[]) => {
          const builder = new ExpectationConfigBuilder(...matchers);
          expectationManager.addExpectation(builder);
          return builder;
        }
      };

      onStart(ctx);
    }

    expectationManager.start(defaultedState);
  }

  stop() {
    if (!this.active || !this.expectationManager) {
      return;
    }

    this.active = false;
    this.expectationManager.stop();
    this.expectationManager = undefined;
  }

  async bootstrap(req: RequestValue, res: ResponseValue) {
    if (!this.active || !this.expectationManager) {
      return;
    }

    const onBootstrap = this.scenarioConfig.onBootstrap;

    if (!onBootstrap) {
      return;
    }

    const ctx: OnBootstrapScenarioContext = {
      globals: this.config.globals,
      req,
      res,
      state: this.expectationManager.getState()
    };

    const responseConfigBuilder = onBootstrap(ctx);

    if (!responseConfigBuilder) {
      return;
    }

    const expectationValue: ExpectationRequestContext = {
      expectationRequestLogs: [],
      globals: ctx.globals,
      req: ctx.req,
      res: ctx.res,
      state: ctx.state,
      times: 1
    };

    const config = responseConfigBuilder.build();
    const action = new RespondAction(config);
    await action.execute(expectationValue);
  }

  async onRequest(ctx: ScenarioRequestContext): Promise<void> {
    if (!this.active || !this.expectationManager) {
      return;
    }

    const scenarioRequestLog: ScenarioRequestLog = {
      expectations: [],
      id: this.scenarioConfig.id,
      state: clone(this.getState())
    };

    ctx.scenarioRequestLogs.push(scenarioRequestLog);

    const expectationManagerCtx: ExpectationManagerRequestContext = {
      expectationRequestLogs: scenarioRequestLog.expectations,
      request: ctx.request,
      response: ctx.response
    };

    return this.expectationManager.onRequest(expectationManagerCtx);
  }

  getId(): string {
    return this.scenarioConfig.id;
  }

  getDescription(): string {
    return this.scenarioConfig.description;
  }

  getFormattedDescription(): string {
    let description = this.getDescription().trim();
    if (typeof description === "string") {
      for (const [key, value] of Object.entries(this.config.globals)) {
        description = description.replace(`{{globals.${key}}}`, value);
      }

      description = md.render(description);
    }

    return description;
  }

  getTags(): string[] {
    return this.scenarioConfig.tags;
  }

  getVisibleStateParams(): JSONSchemaParam[] {
    return this.scenarioConfig.stateParams.filter(x => !x.schema.hidden);
  }

  getState(): StateValue {
    return this.expectationManager?.getState() ?? {};
  }

  isActive(): boolean {
    return this.active;
  }
}
