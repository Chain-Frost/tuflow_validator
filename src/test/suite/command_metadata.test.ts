import * as assert from 'assert';
import {
    classifyCommandValue,
    getInputFileRole,
    isControlTextInput,
    shouldSkipKeyForFileLookup
} from '../../pathParsing';

suite('Documented TUFLOW input command metadata', function () {
    const sourcedCommands: Array<[string, 'control-file' | 'data-file']> = [
        // TCF Appendix A: AD Control File == <.adcf_file>
        ['AD Control File', 'control-file'],
        // ADCF Appendix J: AD BC Database == <file>, AD Global Database == <file>
        ['AD BC Database', 'data-file'],
        ['AD Global Database', 'data-file'],
        // TSCF Appendix I: Read SWMM == <swmm_inp_filename>
        ['Read SWMM', 'data-file']
    ];

    test('documented AD/SWMM file operands are recognised with the correct role', () => {
        for (const [command, role] of sourcedCommands) {
            assert.strictEqual(getInputFileRole(command), role, command);
            assert.strictEqual(classifyCommandValue(command), 'input-file', command);
            assert.strictEqual(shouldSkipKeyForFileLookup(command), false, command);
        }
    });

    test('Read File is an inline control-text include, not an ordinary data input', () => {
        assert.strictEqual(getInputFileRole(' Read   File '), 'inline-read-file');
        assert.strictEqual(isControlTextInput('inline-read-file'), true);
        assert.strictEqual(isControlTextInput('control-file'), true);
        assert.strictEqual(isControlTextInput('data-file'), false);
        assert.strictEqual(getInputFileRole('Geometry Control File'), 'control-file');
        assert.strictEqual(getInputFileRole('Read GIS Z Shape'), 'data-file');
        assert.strictEqual(getInputFileRole('SWMM Control File'), 'control-file');
        assert.strictEqual(getInputFileRole('Read Materials File'), 'data-file');
    });

    test('numeric, output and unrecognised commands never request file lookup', () => {
        for (const command of [
            'Viscosity Coefficients',
            'Viscosity Formulation',
            'Start Time',
            'SWMM Iterations',
            'Some Custom Command',
            'If Scenario',
            'Set Variable ModelRoot',
            'Output Folder',
            'Write Mass Unit'
        ]) {
            assert.strictEqual(getInputFileRole(command), null, command);
            assert.strictEqual(shouldSkipKeyForFileLookup(command), true, command);
        }
        assert.strictEqual(classifyCommandValue('Output Folder'), 'output');
        assert.strictEqual(classifyCommandValue('Some Custom Command'), 'unknown');
    });
});
