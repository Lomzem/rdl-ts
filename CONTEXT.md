# SystemRDL

This glossary defines terms used when discussing SystemRDL source and its meaning.

## Language

**Source document**:
A SystemRDL file's original text, including comments and formatting.

**Elaboration**:
The interpretation of SystemRDL declarations and instances to resolve parameters, references, addresses, field positions, and effective property values.

**Compilation unit**:
A root input file together with its included files. Root declarations are shared across ordered units, while each unit has its own macro and root-default state initialized with caller-provided macro definitions.

**User Defined Property**:
A property declared by a SystemRDL author with a specified type and permitted component kinds. Its declaration and uses follow SystemRDL's property rules.
_Abbreviation_: UDP.
