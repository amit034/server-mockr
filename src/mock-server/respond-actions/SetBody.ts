import { ExpectationValue } from "../Values";
import { RespondAction } from "./RespondAction";

/*
 * ACTION
 */

export class SetBodyAction implements RespondAction {
  constructor(private body?: string) {}

  async execute(ctx: ExpectationValue): Promise<void> {
    if (typeof this.body === "string" || (typeof this.body === "object" && (this.body as object).constructor.name === 'Buffer')) {
      ctx.res.body = this.body;
    }
  }
}
