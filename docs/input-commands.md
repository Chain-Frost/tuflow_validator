# Command-aware input validation (TUFLOW Classic/HPC)

This is an input-file existence validator, not a general TUFLOW syntax checker. Only a recognised file-consuming command participates in path validation. Unknown commands, values/expressions and output commands are not used as filenames. Physical file checks do not inspect GeoPackage layers, CSV databases, GIS contents or SWMM INP records.

## Documented additions

The operand definitions below were checked against the official **2026.3** TUFLOW Classic/HPC manual. A command's *role* determines whether its target is command text or data; a filename suffix alone must not decide that.

| Command | Official syntax / role | Reference |
| --- | --- | --- |
| `AD Control File` | `AD Control File == <.adcf_file>`; TCF to AD control text | [TCF Appendix A](https://docs.tuflow.com/classic-hpc/manual/2026.3/80-AppendicesA-TCFCommands.html) |
| `AD BC Database` | `AD BC Database == <file>`; ADCF to boundary CSV database, physical file only | [ADCF Appendix J](https://docs.tuflow.com/classic-hpc/manual/2026.3/89-AppendicesJ-ADCFCommands.html) |
| `AD Global Database` | `AD Global Database == <file>`; ADCF to constituent CSV database, physical file only | [ADCF Appendix J](https://docs.tuflow.com/classic-hpc/manual/2026.3/89-AppendicesJ-ADCFCommands.html) |
| `Read SWMM` | `Read SWMM == <swmm_inp_filename>`; TSCF to SWMM INP data, physical file only; repeat the command for multiple INP inputs | [TSCF Appendix I](https://docs.tuflow.com/classic-hpc/manual/2026.3/88-AppendicesI-TSCFCommands.html) |

The AD databases and SWMM INP files contain *data*, not TUFLOW control commands. They must never be recursively interpreted as control text. The ADCF is control text.

## Control-text includes

`Read File == <file>` performs inline control-command inclusion, independent of the extension. `.trd`, `.erd` and `.rdf` are conventional, **not required**, extensions. Other control-file commands (for example `Geometry Control File`, `SWMM Control File`, `AD Control File`) refer to control text. `Read GIS ...`, `Read GRID ...`, `Read SWMM` and database commands refer to data.

Sources: [TCF Appendix A — Read File](https://docs.tuflow.com/classic-hpc/manual/2026.3/80-AppendicesA-TCFCommands.html), [Control files section 4.1.16](https://docs.tuflow.com/classic-hpc/manual/2026.3/04-ControlFiles-and-Inputs.html).

## Deliberate limits

- The command allowlist is not a complete grammar. No speculative paths are generated for unknown, numeric, output or option commands.
- Static variables may be expanded when deterministically defined; runtime scenario/event tokens stay unresolved.
- `| ` operands, layer selectors `>>`, existing line/file ignores and source-TCF-relative TRD behavior remain as implemented.
- A concretely resolved missing input is an error, even in a runtime conditional block.
- This work does not inspect file contents for datasets, invoke TUFLOW, change filename-version matching, or depend on deferred GeoPackage layer-validation PR #9.
