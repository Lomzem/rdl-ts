import type { ComponentKind, ExternalProperty, RdlValue } from "./types.js";
import { integer, reservedEnum } from "./expressions.js";
export interface PropertyRule {
  readonly type: string;
  readonly components: readonly ComponentKind[];
  readonly dynamic: boolean;
  readonly default?: RdlValue;
  readonly group?: string;
}
const ALL: ComponentKind[] = ["addrmap", "regfile", "reg", "field", "mem", "signal"];
const rules: Record<string, PropertyRule> = {};
function add(
  names: string,
  type: string,
  components: ComponentKind[],
  dynamic = true,
  value?: RdlValue,
) {
  for (const name of names.split(" "))
    rules[name] = { type, components, dynamic, ...(value === undefined ? {} : { default: value }) };
}
add("name desc", "string", ALL);
add("ispresent", "boolean", ALL, true, true);
add("donttest dontcompare", "boolean|bit", ["field", "reg", "regfile", "addrmap"], true, false);
add("hdl_path hdl_path_gate", "string", ["addrmap", "regfile", "reg"]);
add("hdl_path_slice hdl_path_gate_slice", "string[]", ["field", "mem"]);
add("signalwidth", "longint unsigned", ["signal"], false, integer(1n));
add("sync async cpuif_reset field_reset activehigh activelow", "boolean", ["signal"], true, false);
add("regwidth", "longint unsigned", ["reg"], false, integer(32n));
add("accesswidth", "longint unsigned", ["reg"]);
add("shared", "boolean", ["reg"], false, false);
add("errextbus", "boolean", ["addrmap", "regfile", "reg"], false, false);
add("alignment", "longint unsigned", ["addrmap", "regfile"], false);
add("sharedextbus", "boolean", ["addrmap", "regfile"], false, false);
add("addressing", "addressingtype", ["addrmap"], false, reservedEnum("regalign"));
add("bigendian littleendian", "boolean", ["addrmap"], true, false);
add("rsvdset rsvdsetX msb0 lsb0 bridge", "boolean", ["addrmap"], false, false);
add("mementries", "longint unsigned", ["mem"], false, integer(1n));
add("memwidth", "longint unsigned", ["mem"], false, integer(32n));
add("sw", "accesstype", ["field", "mem"], true, reservedEnum("rw"));
add("hw", "accesstype", ["field"], false, reservedEnum("rw"));
add("fieldwidth", "longint unsigned", ["field"], false, integer(1n));
add("reset", "bit|ref", ["field"]);
add("next resetsignal hwenable hwmask enable mask haltenable haltmask incr decr", "ref", ["field"]);
add("we wel hwset hwclr swwe swwel", "boolean|ref", ["field"], true, false);
add("incrvalue decrvalue", "bit|ref", ["field"]);
add("incrwidth decrwidth", "longint unsigned", ["field"], true, integer(1n));
add(
  "incrsaturate decrsaturate saturate incrthreshold decrthreshold threshold",
  "boolean|bit|ref",
  ["field"],
  true,
  false,
);
add(
  "swacc swmod singlepulse woclr woset rclr rset anded ored xored counter overflow underflow intr sticky stickybit",
  "boolean",
  ["field"],
  true,
  false,
);
add("paritycheck", "boolean", ["field"], false, false);
add("onread", "onreadtype", ["field"]);
add("onwrite", "onwritetype", ["field"]);
add("precedence", "precedencetype", ["field"], true, reservedEnum("sw"));
add("encode", "enumtype", ["field"]);
for (const group of [
  "activehigh activelow",
  "sync async",
  "bigendian littleendian",
  "msb0 lsb0",
  "rsvdset rsvdsetX",
  "hwenable hwmask",
  "we wel",
  "enable mask",
  "haltenable haltmask",
  "counter intr",
  "sticky stickybit",
  "incrvalue incrwidth",
  "decrvalue decrwidth",
  "swwe swwel",
  "onread rclr rset",
  "onwrite woclr woset",
  "donttest dontcompare",
])
  for (const name of group.split(" ")) rules[name] = { ...rules[name]!, group };
export const builtinProperties: Readonly<Record<string, PropertyRule>> = rules;
export function isDynamicallyAssignable(
  name: string,
  kind: ComponentKind,
  properties: readonly ExternalProperty[] = [],
): boolean {
  const builtin = rules[name];
  if (builtin) return builtin.dynamic && builtin.components.includes(kind);
  const property = properties.find((p) => p.name === name);
  return (
    property !== undefined &&
    (property.components.includes("all") || property.components.includes(kind))
  );
}
