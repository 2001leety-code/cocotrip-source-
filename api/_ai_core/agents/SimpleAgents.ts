import { BaseAgent } from "./BaseAgent";

export class PlannerAgent extends BaseAgent {
  constructor(apiKey: string) {
    super(apiKey, "planner");
  }
}

export class DesignerAgent extends BaseAgent {
  constructor(apiKey: string) {
    super(apiKey, "designer");
  }
}

export class MarketingAgent extends BaseAgent {
  constructor(apiKey: string) {
    super(apiKey, "marketing");
  }
}

export class CSAgent extends BaseAgent {
  constructor(apiKey: string) {
    super(apiKey, "cs");
  }
}
