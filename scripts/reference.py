"""Small compiler interoperability comparison, independent of source preservation."""
import json
import sys
from systemrdl import RDLCompiler
from systemrdl.node import AddressableNode, FieldNode, RootNode

compiler = RDLCompiler()
compiler.compile_file(sys.argv[1])
root = compiler.elaborate(top_def_name="top")

def path(node):
    names = []
    while not isinstance(node, RootNode):
        names.append(node.inst_name)
        node = node.parent
    return ".".join(reversed(names))

records = []
for node in root.descendants(unroll=False):
    record = {"path": path(node)}
    if isinstance(node, AddressableNode):
        record["address"] = str(node.raw_absolute_address)
        record["size"] = str(node.size)
    if isinstance(node, FieldNode):
        record["lsb"] = str(node.lsb)
        record["msb"] = str(node.msb)
    for prop in ("reset", "owner", "count"):
        try:
            value = node.get_property(prop)
        except LookupError:
            continue
        if value is not None:
            record[prop] = str(value)
    records.append(record)
print(json.dumps(records))
