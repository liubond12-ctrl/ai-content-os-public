import { assembleContext } from "./assembler";
import type {
  ComparisonResult,
  ResolvedTaskConfig,
  TaskInput,
} from "./types";

export async function compareContexts(
  leftInput: TaskInput,
  rightInput: TaskInput,
): Promise<ComparisonResult> {
  const [left, right] = await Promise.all([
    assembleContext(leftInput),
    assembleContext(rightInput),
  ]);
  const leftModules = new Map(
    left.manifest.loadedModules.map((module) => [module.id, module]),
  );
  const rightModules = new Map(
    right.manifest.loadedModules.map((module) => [module.id, module]),
  );
  const fields = Object.keys(
    left.manifest.resolvedConfig,
  ) as Array<keyof ResolvedTaskConfig>;
  const leftConflictIds = new Set(
    left.manifest.conflicts.map((conflict) => conflict.id),
  );
  const rightConflictIds = new Set(
    right.manifest.conflicts.map((conflict) => conflict.id),
  );

  return {
    left,
    right,
    diff: {
      addedModules: right.manifest.loadedModules.filter(
        (module) => !leftModules.has(module.id) || leftModules.get(module.id)?.sha256 !== module.sha256,
      ),
      removedModules: left.manifest.loadedModules.filter(
        (module) => !rightModules.has(module.id) || rightModules.get(module.id)?.sha256 !== module.sha256,
      ),
      unchangedModuleIds: left.manifest.loadedModules
        .filter(
          (module) =>
            rightModules.get(module.id)?.sha256 === module.sha256,
        )
        .map((module) => module.id),
      changedFields: fields
        .filter(
          (field) =>
            JSON.stringify(left.manifest.resolvedConfig[field]) !==
            JSON.stringify(right.manifest.resolvedConfig[field]),
        )
        .map((field) => ({
          field,
          left: left.manifest.resolvedConfig[field],
          right: right.manifest.resolvedConfig[field],
        })),
      conflictIdsOnlyOnLeft: [...leftConflictIds].filter(
        (id) => !rightConflictIds.has(id),
      ),
      conflictIdsOnlyOnRight: [...rightConflictIds].filter(
        (id) => !leftConflictIds.has(id),
      ),
    },
  };
}
