import type { Result } from "effect";

export type ComponentKind = "addrmap" | "regfile" | "reg" | "field" | "mem" | "signal";
export interface SourceRange {
  readonly documentId: string;
  readonly start: number;
  readonly end: number;
}
export interface SourceProvenance {
  readonly range: SourceRange;
  readonly generated: boolean;
  readonly chain?: readonly SourceRange[];
  readonly logical?: { readonly file: string; readonly line: number };
}
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}
export interface SourceLocation {
  readonly documentId: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}
export interface Diagnostic {
  readonly provenance?: SourceProvenance;
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly phase: "syntax" | "preprocess" | "semantic" | "custom" | "resource";
  readonly message: string;
  readonly range?: SourceRange;
  readonly related?: readonly SourceRange[];
  readonly origin?: string;
}
export interface SourceFile {
  readonly id: string;
  readonly text: string;
  readonly writable?: boolean;
}
export interface IncludeBinding {
  readonly from: string;
  readonly request: string;
  readonly to: string;
}
export interface Configuration {
  readonly id: string;
  readonly roots: readonly string[];
  readonly top?: string;
  readonly macros?: Readonly<Record<string, string>>;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly includes?: readonly IncludeBinding[];
}
export interface ExternalProperty {
  readonly name: string;
  readonly type: string;
  readonly components: readonly (ComponentKind | "all" | "constraint")[];
  readonly default?: string;
  readonly constraint?: "componentwidth";
  readonly origin: string;
}
export interface Validator {
  readonly id: string;
  readonly version: string;
  readonly validate: (
    report: AnalysisReport,
  ) => Result.Result<readonly Diagnostic[], { readonly message: string }>;
}
export interface ProjectInput {
  readonly files: readonly SourceFile[];
  readonly configurations: readonly Configuration[];
  readonly properties?: readonly ExternalProperty[];
  readonly validators?: readonly Validator[];
  readonly limits?: {
    readonly includeDepth?: number;
    readonly expandedCharacters?: number;
    readonly instances?: number;
  };
}
export interface ExpressionSyntax {
  readonly text: string;
  readonly range: SourceRange;
}
export interface ParameterSyntax {
  readonly name: string;
  readonly type: string;
  readonly value?: ExpressionSyntax;
  readonly range: SourceRange;
}
export interface ArgumentSyntax {
  readonly name?: string;
  readonly value: ExpressionSyntax;
}
/** Internal syntax records are also exposed as immutable source inspection data. */
export interface SyntaxNode {
  readonly id: string;
  readonly kind:
    | "component"
    | "instance"
    | "assignment"
    | "property"
    | "enum"
    | "enumMember"
    | "struct"
    | "member"
    | "constraint"
    | "unknown";
  readonly name: string;
  readonly range: SourceRange;
  readonly nameRange?: SourceRange;
  readonly bodyRange?: SourceRange;
  readonly component?: ComponentKind;
  readonly typeName?: string;
  readonly typeRange?: SourceRange;
  readonly children?: readonly SyntaxNode[];
  readonly instances?: readonly SyntaxNode[];
  readonly parameters?: readonly ParameterSyntax[];
  readonly arguments?: readonly ArgumentSyntax[];
  readonly expression?: ExpressionSyntax;
  readonly dimensions?: readonly ExpressionSyntax[];
  readonly msb?: ExpressionSyntax;
  readonly lsb?: ExpressionSyntax;
  readonly address?: ExpressionSyntax;
  readonly stride?: ExpressionSyntax;
  readonly alignment?: ExpressionSyntax;
  readonly default?: boolean;
  readonly target?: string;
  readonly modifier?: "posedge" | "negedge" | "bothedge" | "level" | "nonsticky";
  readonly targetRange?: SourceRange;
  readonly alias?: string;
  readonly external?: boolean;
  readonly internal?: boolean;
  readonly abstract?: boolean;
  readonly extends?: string;
  readonly uncertain?: boolean;
}
export interface Comment {
  readonly range: SourceRange;
  readonly text: string;
}
export interface ParsedDocument {
  readonly nodes: readonly SyntaxNode[];
  readonly diagnostics: readonly Diagnostic[];
  readonly comments: readonly Comment[];
}
export interface ExpansionOrigin {
  readonly start: number;
  readonly end: number;
  readonly source: SourceRange;
  readonly generated: boolean;
  readonly chain?: readonly SourceRange[];
  readonly logical?: { readonly file: string; readonly line: number };
}
export interface ExpandedUnit {
  readonly root: string;
  readonly text: string;
  readonly origins: readonly ExpansionOrigin[];
}
export interface PreprocessResult {
  readonly units: readonly ExpandedUnit[];
  readonly diagnostics: readonly Diagnostic[];
  readonly complete: boolean;
}
export interface IntegerValue {
  readonly kind: "integer";
  readonly value: bigint;
  readonly width: bigint;
}
export interface EnumValue {
  readonly kind: "enum";
  readonly typeDefinition?: SourceRange;
  readonly width?: bigint;
  readonly type: string;
  readonly member: string;
  readonly value?: bigint;
}
export interface ReferenceValue {
  readonly kind: "reference";
  readonly path: string;
  readonly property?: string;
}
export interface StructValue {
  readonly kind: "struct";
  readonly typeDefinition?: SourceRange;
  readonly type: string;
  readonly members: Readonly<Record<string, RdlValue>>;
}
export type RdlValue =
  | IntegerValue
  | EnumValue
  | ReferenceValue
  | StructValue
  | boolean
  | string
  | readonly RdlValue[];
export interface PropertyValue {
  readonly provenance?: SourceProvenance;
  readonly binding: "builtin" | "bound" | "unbound";
  readonly state: "known" | "undefined" | "unavailable";
  readonly value?: RdlValue;
  readonly origin: "builtin" | "default" | "assignment" | "dynamic" | "unbound";
  readonly range?: SourceRange;
}
export interface Instance {
  readonly sourceProvenance?: SourceProvenance;
  readonly definitionProvenance?: SourceProvenance;
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly kind: ComponentKind;
  readonly definition: SourceRange;
  readonly source: SourceRange;
  readonly properties: Readonly<Record<string, PropertyValue>>;
  readonly children: readonly Instance[];
  readonly dimensions: readonly bigint[];
  readonly address?: bigint;
  readonly size?: bigint;
  readonly stride?: bigint;
  readonly lsb?: bigint;
  readonly msb?: bigint;
  readonly alias?: string;
  readonly interruptType?: "posedge" | "negedge" | "bothedge" | "level";
}
export interface Coverage {
  readonly complete: boolean;
  readonly reasons: readonly string[];
}
export interface SymbolReference {
  readonly provenance?: SourceProvenance;
  readonly name: string;
  readonly definition: SourceRange;
  readonly range: SourceRange;
  readonly generated?: boolean;
}
export interface AnalysisReport {
  readonly revision: string;
  readonly configurationId: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly coverage: Coverage;
  readonly model: "complete" | "partial" | "unavailable";
  readonly roots: readonly Instance[];
  readonly references: readonly SymbolReference[];
}
export interface SourceHandle {
  readonly revision: string;
  readonly nodeId: string;
  readonly documentId: string;
}
export interface InstanceHandle {
  readonly revision: string;
  readonly configurationId: string;
  readonly instanceId: string;
}
export interface SourceDocument extends SourceFile {
  readonly nodes: readonly SyntaxNode[];
  readonly diagnostics: readonly Diagnostic[];
  readonly comments: readonly Comment[];
}
export interface ProjectSnapshot {
  readonly revision: string;
  readonly files: readonly SourceFile[];
  readonly configurations: readonly Configuration[];
}
export interface SourceView {
  readonly documents: readonly SourceDocument[];
}
export interface Failure {
  readonly _tag: "InputError" | "AnalysisFailure" | "PrepareFailure" | "ApplyFailure";
  readonly code: string;
  readonly message: string;
  readonly range?: SourceRange;
}
export interface TextEdit {
  readonly documentId: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
export interface ComponentSpec {
  readonly kind: ComponentKind;
  readonly name?: string;
  readonly instance?: string;
  readonly properties?: Readonly<Record<string, string>>;
  readonly children?: readonly (ComponentSpec | InstanceSpec)[];
  readonly dimensions?: readonly string[];
  readonly address?: string;
  readonly range?: { readonly msb: string; readonly lsb: string };
}
export interface InstanceSpec {
  readonly kind: "instance";
  readonly type: string;
  readonly name: string;
  readonly arguments?: Readonly<Record<string, string>> | readonly string[];
  readonly dimensions?: readonly string[];
  readonly address?: string;
  readonly stride?: string;
  readonly alignment?: string;
  readonly external?: boolean;
  readonly range?: { readonly msb: string; readonly lsb: string };
}
export type EditCommand =
  | {
      readonly kind: "replaceExpression";
      readonly target: SourceHandle;
      readonly expression: string;
      readonly slot?:
        | "expression"
        | "address"
        | "stride"
        | "alignment"
        | "msb"
        | "lsb"
        | { readonly parameter: string }
        | { readonly argument: string | number };
    }
  | {
      readonly kind: "setProperty";
      readonly target: SourceHandle;
      readonly property: string;
      readonly expression?: string;
    }
  | { readonly kind: "removeProperty"; readonly target: SourceHandle; readonly property: string }
  | {
      readonly kind: "setInstanceProperty";
      readonly target: InstanceHandle;
      readonly property: string;
      readonly expression: string;
    }
  | { readonly kind: "delete"; readonly target: SourceHandle }
  | { readonly kind: "duplicate"; readonly target: SourceHandle; readonly name: string }
  | {
      readonly kind: "rename";
      readonly target: SourceHandle;
      readonly name: string;
      readonly partial?: boolean;
    }
  | {
      readonly kind: "insertComponent";
      readonly documentId: string;
      readonly parent?: SourceHandle;
      readonly component: ComponentSpec;
      readonly before?: SourceHandle;
    }
  | {
      readonly kind: "insertInstance";
      readonly documentId: string;
      readonly parent?: SourceHandle;
      readonly before?: SourceHandle;
      readonly instance: InstanceSpec;
    }
  | {
      readonly kind: "createDocument";
      readonly documentId: string;
      readonly components?: readonly (ComponentSpec | InstanceSpec)[];
      readonly roots?: readonly string[];
    }
  | {
      readonly kind: "declareProperty";
      readonly documentId: string;
      readonly property: ExternalProperty;
    }
  | {
      readonly kind: "editPropertyDeclaration";
      readonly target: SourceHandle;
      readonly property: ExternalProperty;
    };
export type PrepareOptions =
  | { readonly mode: "sourceOnly" }
  | { readonly mode: "configured"; readonly configurations: readonly string[] };
export type AcceptancePolicy = "checked" | "draft";
export interface LayoutChange {
  readonly configurationId: string;
  readonly path: string;
  readonly previousPath?: string;
  readonly before?: { readonly address?: bigint; readonly lsb?: bigint; readonly msb?: bigint };
  readonly after?: { readonly address?: bigint; readonly lsb?: bigint; readonly msb?: bigint };
}
export interface EditCandidate {
  readonly baseRevision: string;
  readonly snapshot: ProjectSnapshot;
  readonly edits: readonly TextEdit[];
  readonly reports: readonly AnalysisReport[];
  readonly diagnostics: readonly Diagnostic[];
  readonly layoutChanges: readonly LayoutChange[];
  readonly comparisonCoverage: Coverage;
}
