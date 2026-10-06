import "server-only";

/**
 * Consumer bootstrap. The worker imports this module once; each side-effect import below calls
 * `registerConsumer(...)`. Other domains do not register consumers directly: they call Agent D's exported
 * functions (see docs/_CONTRACTS.md).
 */
import "./learning-evidence";

export { registerConsumer, getConsumers, consumersFor } from "./registry";
export { registerLearningConsumers } from "./learning-evidence";
