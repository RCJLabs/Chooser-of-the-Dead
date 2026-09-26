import fc from 'fast-check';

export {
  botBattle,
  botOrder,
  catchLie,
  JUDGING,
  type Judging,
  type NightStrategy,
  PLAIN,
  type PolicyReport,
  type RunResult,
  type SceneTable,
  type SimOptions,
  STORY_POLICIES,
  type StoryPolicy,
  scenarioSave,
  scorePath,
  simulateCampaign,
  simulateRun,
  storyPolicy,
} from './campaign-sim';
export { loadContent, loadDailyContent, loadScenes } from './content';
export { type OracleResult, oracleSolve } from './oracle';
export { oracleSolveReference } from './oracle-reference';
export { checkThresholds, type SweepOptions, type SweepReport, sweep, THRESHOLDS } from './sweep';
export { fc };

/** A short non-empty seed string, the shape the engine's RNG takes. */
export const arbSeed = (): fc.Arbitrary<string> => fc.string({ minLength: 1, maxLength: 16 });
