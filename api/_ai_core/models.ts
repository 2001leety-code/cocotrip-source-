export interface TripRequest {
  destination: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  preferences: string;
  pax: number;
  language: string;
  vehicleType: string;
}

export interface AgentResult {
  agentName: string;
  systemPrompt: string;
  userPrompt: string;
  rawOutput: string;
  thinkingSummary: string;
  inputTokens: number;
  outputTokens: number;
}

export interface PipelineResult {
  request: TripRequest;
  agentResults: AgentResult[];
  finalOutput: string;
  totalTokens: number;
}
