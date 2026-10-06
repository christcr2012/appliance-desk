type BackupPolicy = Record<string, string | null>;

type ModelBlock = { name: string; body: string };
type ParsedField = { name: string; type: string; optional: boolean; attributes: string };

export type RelationDependency = { model: string; dependsOn: string };
export type AutoincrementField = { model: string; delegate: string; field: string };

function modelBlocks(schema: string): ModelBlock[] {
  if (schema.includes("@@map(") || /\s@map\(/.test(schema)) {
    throw new Error("Restore ordering does not support mapped Prisma table or field names.");
  }
  const blocks = [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)].map((match) => ({
    name: match[1]!,
    body: match[2]!,
  }));
  if (blocks.length === 0) throw new Error("No Prisma models were found.");
  return blocks;
}

function fields(block: ModelBlock): ParsedField[] {
  const parsed: ParsedField[] = [];
  for (const raw of block.body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const match = line.match(/^(\w+)\s+([A-Za-z_]\w*)(\[\]|\?)?(?:\s+(.*))?$/);
    if (!match) continue;
    parsed.push({
      name: match[1]!,
      type: match[2]!,
      optional: match[3] === "?",
      attributes: match[4] ?? "",
    });
  }
  return parsed;
}

export function prismaModelNames(schema: string): string[] {
  return modelBlocks(schema).map((block) => block.name);
}

export function relationDependencies(schema: string): RelationDependency[] {
  const blocks = modelBlocks(schema);
  const names = new Set(blocks.map((block) => block.name));
  const dependencies: RelationDependency[] = [];
  for (const block of blocks) {
    for (const field of fields(block)) {
      if (
        names.has(field.type) &&
        field.attributes.includes("@relation") &&
        /fields\s*:/.test(field.attributes)
      ) {
        dependencies.push({ model: block.name, dependsOn: field.type });
      }
    }
  }
  return dependencies;
}

export function deriveRestoreTableOrder(schema: string, policy: BackupPolicy): string[] {
  const names = new Set(prismaModelNames(schema));
  for (const model of Object.keys(policy)) {
    if (!names.has(model)) throw new Error(\`Backup policy names missing Prisma model "\${model}".\`);
  }

  const included = Object.entries(policy)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([model]) => model);
  const includedSet = new Set(included);
  const dependencies = new Map(included.map((model) => [model, new Set<string>()]));
  for (const edge of relationDependencies(schema)) {
    if (includedSet.has(edge.model) && includedSet.has(edge.dependsOn)) {
      dependencies.get(edge.model)!.add(edge.dependsOn);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const orderedModels: string[] = [];
  const visit = (model: string, path: string[]): void => {
    if (visited.has(model)) return;
    if (visiting.has(model)) {
      throw new Error(\`Restore dependency cycle: \${[...path, model].join(" -> ")}\`);
    }
    visiting.add(model);
    for (const dependency of dependencies.get(model) ?? []) visit(dependency, [...path, model]);
    visiting.delete(model);
    visited.add(model);
    orderedModels.push(model);
  };
  for (const model of included) visit(model, []);
  return orderedModels.map((model) => policy[model]!);
}

export function dateTimeFieldsByDelegate(
  schema: string,
  policy: BackupPolicy,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const block of modelBlocks(schema)) {
    const delegate = policy[block.name];
    if (!delegate) continue;
    result[delegate] = fields(block).filter((field) => field.type === "DateTime").map((field) => field.name);
  }
  return result;
}

export function nullableJsonFieldsByDelegate(
  schema: string,
  policy: BackupPolicy,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const block of modelBlocks(schema)) {
    const delegate = policy[block.name];
    if (!delegate) continue;
    result[delegate] = fields(block)
      .filter((field) => field.type === "Json" && field.optional)
      .map((field) => field.name);
  }
  return result;
}

export function autoincrementFields(schema: string, policy: BackupPolicy): AutoincrementField[] {
  const result: AutoincrementField[] = [];
  for (const block of modelBlocks(schema)) {
    const delegate = policy[block.name];
    if (!delegate) continue;
    for (const field of fields(block)) {
      if (field.attributes.includes("@default(autoincrement())")) {
        result.push({ model: block.name, delegate, field: field.name });
      }
    }
  }
  return result;
}
