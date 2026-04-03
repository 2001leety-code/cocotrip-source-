import { BaseAgent } from "./BaseAgent.js";
export class PlannerAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "planner");
    }
}
export class DesignerAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "designer");
    }
}
export class MarketingAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "marketing");
    }
}
export class CSAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "cs");
    }
}
