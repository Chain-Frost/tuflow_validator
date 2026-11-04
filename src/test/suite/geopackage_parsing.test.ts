import * as assert from 'assert';
import {
    extractGisReferences,
    extractPathCandidates,
    GisReferenceToken,
    isGeoPackageInputCommand,
    unquoteReference
} from '../../pathParsing';

suite('GeoPackage reference parsing', () => {
    test('retains implicit paths and explicit selectors without choosing a layer', () => {
        const implicit = extractGisReferences('  terrain.gpkg  ', 12, 3);
        assert.strictEqual(implicit.length, 1);
        assertToken(implicit[0].path, 'terrain.gpkg', 14, 3);
        assert.strictEqual(implicit[0].explicit, false);
        assert.deepStrictEqual(implicit[0].layers, []);

        const explicit = extractGisReferences('terrain.gpkg >> contours', 0, 0);
        assert.strictEqual(explicit[0].explicit, true);
        assertToken(explicit[0].path, 'terrain.gpkg', 0, 0);
        assertToken(explicit[0].layers[0], 'contours', 16, 0);
    });

    test('separates databases with | and layers with && at exact source ranges', () => {
        const value = ' model.gpkg >> lines && points | other.gpkg>>missing&&use all ';
        const references = extractGisReferences(value, 20, 7);
        assert.strictEqual(references.length, 2);
        assertToken(references[0].path, 'model.gpkg', 20 + value.indexOf('model.gpkg'), 7);
        assertToken(references[0].layers[0], 'lines', 20 + value.indexOf('lines'), 7);
        assertToken(references[0].layers[1], 'points', 20 + value.indexOf('points'), 7);
        assertToken(references[1].path, 'other.gpkg', 20 + value.indexOf('other.gpkg'), 7);
        assertToken(references[1].layers[0], 'missing', 20 + value.indexOf('missing'), 7);
        assertToken(references[1].layers[1], 'use all', 20 + value.indexOf('use all'), 7);
        assert.ok(references.every(reference => reference.explicit));
    });

    test('keeps layer-only && lists available to Spatial Database resolution', () => {
        const value = 'first && second | third && fourth';
        const references = extractGisReferences(value, 4, 2);
        assert.strictEqual(references.length, 2);
        assertToken(references[0].path, 'first', 4, 2);
        assertToken(references[0].layers[0], 'second', 4 + value.indexOf('second'), 2);
        assertToken(references[1].path, 'third', 4 + value.indexOf('third'), 2);
        assertToken(references[1].layers[0], 'fourth', 4 + value.indexOf('fourth'), 2);
        assert.ok(references.every(reference => !reference.explicit));
    });

    test('keeps each dynamic selector separate from its concrete database and siblings', () => {
        const value = 'gis/model.gpkg >> fixed && layer_<<~s1~>> && layer_<<~~s1~~>>';
        const references = extractGisReferences(value, 2, 4);
        assert.strictEqual(references.length, 1);
        assertToken(references[0].path, 'gis/model.gpkg', 2, 4);
        assert.deepStrictEqual(references[0].layers.map(layer => layer.text), [
            'fixed', 'layer_<<~s1~>>', 'layer_<<~~s1~~>>'
        ]);
        for (const layer of references[0].layers) {
            assertToken(layer, layer.text, 2 + value.indexOf(layer.text), 4);
        }
    });

    test('does not confuse macro endings with a selector or expand static variables', () => {
        const value = '<<Directory>>/model_<<~e1~>>.gpkg >> <<Layer>> | <<Database>>';
        const references = extractGisReferences(value, 0, 0);
        assert.strictEqual(references.length, 2);
        assert.strictEqual(references[0].path.text, '<<Directory>>/model_<<~e1~>>.gpkg');
        assert.strictEqual(references[0].explicit, true);
        assert.strictEqual(references[0].layers[0].text, '<<Layer>>');
        assert.strictEqual(references[1].path.text, '<<Database>>');
        assert.strictEqual(references[1].explicit, false);
        assert.deepStrictEqual(references[1].layers, []);
    });

    test('ignores all separator characters inside macros', () => {
        const value = 'model.gpkg >> <<unknown|name&&other>> && fixed';
        const references = extractGisReferences(value, 0, 0);
        assert.strictEqual(references.length, 1);
        assert.deepStrictEqual(references[0].layers.map(layer => layer.text), [
            '<<unknown|name&&other>>', 'fixed'
        ]);
    });

    test('unquotes complete atoms and ignores separators inside their quotes', () => {
        const value = ` "Q:\\model inputs\\model.gpkg" >> "line|main" && 'point&&side' | "a >> b.gpkg" `;
        const references = extractGisReferences(value, 10, 5);
        assert.strictEqual(references.length, 2);
        assertToken(references[0].path, 'Q:\\model inputs\\model.gpkg', 12, 5);
        assertToken(references[0].layers[0], 'line|main', 10 + value.indexOf('line|main'), 5);
        assertToken(references[0].layers[1], 'point&&side', 10 + value.indexOf('point&&side'), 5);
        assertToken(references[1].path, 'a >> b.gpkg', 10 + value.indexOf('a >> b.gpkg'), 5);
        assert.strictEqual(references[1].explicit, false);
        assert.strictEqual(unquoteReference('  "  layer  "  '), '  layer  ');
        assert.strictEqual(unquoteReference(" 'layer' "), 'layer');
        assert.strictEqual(unquoteReference('  "unclosed  '), '"unclosed');
    });

    test('preserves Windows drive, UNC, mapped and relative paths verbatim', () => {
        const paths = [
            String.raw`C:\Models\terrain.gpkg`,
            String.raw`\\server\share\terrain.gpkg`,
            String.raw`Q:\project\terrain.gpkg`,
            String.raw`..\gis\terrain.gpkg`
        ];
        for (const filePath of paths) {
            const value = `${filePath} >> terrain`;
            const reference = extractGisReferences(value, 0, 0)[0];
            assertToken(reference.path, filePath, 0, 0);
            assertToken(reference.layers[0], 'terrain', filePath.length + 4, 0);
        }
    });

    test('does not treat an apostrophe in an unquoted filename as an opening quote', () => {
        const value = "O'Brien.gpkg >> line | next.gpkg >> point";
        const references = extractGisReferences(value, 0, 0);
        assert.strictEqual(references.length, 2);
        assert.strictEqual(references[0].path.text, "O'Brien.gpkg");
        assert.strictEqual(references[0].layers[0].text, 'line');
        assert.strictEqual(references[1].path.text, 'next.gpkg');
    });

    test('does not interpret Windows backslashes as quote escapes', () => {
        const value = String.raw`"Q:\folder\" >> layer`;
        const reference = extractGisReferences(value, 0, 0)[0];
        assert.strictEqual(reference.path.text, 'Q:\\folder\\');
        assert.strictEqual(reference.layers[0].text, 'layer');
        assert.strictEqual(reference.explicit, true);
    });

    test('does not fabricate entries for empty input, segments, or selectors', () => {
        assert.deepStrictEqual(extractGisReferences('  | |  ', 0, 0), []);
        assert.deepStrictEqual(extractGisReferences(' >> layer', 0, 0), []);
        const references = extractGisReferences('model.gpkg >> && lines && | next.gpkg', 0, 0);
        assert.strictEqual(references.length, 2);
        assert.deepStrictEqual(references[0].layers.map(layer => layer.text), ['lines']);
        const emptySelector = extractGisReferences('model.gpkg >> ', 0, 0)[0];
        assert.strictEqual(emptySelector.explicit, true);
        assert.deepStrictEqual(emptySelector.layers, []);
    });

    test('conservatively retains incomplete quoted strings and macros', () => {
        const quoted = extractGisReferences('model.gpkg >> "unfinished | next.gpkg', 0, 0);
        assert.strictEqual(quoted.length, 1);
        assert.strictEqual(quoted[0].layers[0].text, '"unfinished | next.gpkg');
        const macro = extractGisReferences('model.gpkg >> <<unfinished && next', 0, 0);
        assert.strictEqual(macro.length, 1);
        assert.strictEqual(macro[0].layers[0].text, '<<unfinished && next');
    });

    test('keeps duplicate selectors with their separate source ranges', () => {
        const value = 'model.gpkg >> lines && lines';
        const reference = extractGisReferences(value, 3, 6)[0];
        assert.strictEqual(reference.layers.length, 2);
        assertToken(reference.layers[0], 'lines', 3 + value.indexOf('lines'), 6);
        assertToken(reference.layers[1], 'lines', 3 + value.lastIndexOf('lines'), 6);
    });

    test('recognises GeoPackage input families without reinterpreting other commands', () => {
        for (const command of [
            'Read GIS Z Shape', ' read  grid  Zpts MAX ', 'Read GPKG BC',
            'GPKG Projection', 'Calibration Points GIS File'
        ]) {
            assert.strictEqual(isGeoPackageInputCommand(command), true, command);
        }
        for (const command of [
            'Spatial Database', 'Spatial Database Output', 'Write GIS Zpts',
            'Write Empty GIS Files', 'Output Folder', 'GIS Format', 'Grid Format',
            'Read File', 'Read Materials File', 'Read Grid', 'Read GIS',
            'If Scenario', 'Some Custom Command', 'SHP Projection', 'Set Variable GPKG',
            '1D Read GIS Network', '1D GPKG Projection', '1D Spatial Database'
        ]) {
            assert.strictEqual(isGeoPackageInputCommand(command), false, command);
        }
    });

    test('leaves legacy path extraction unchanged for the default disabled mode', () => {
        const value = ' "model.gpkg" >> lines && points | <<Directory>>/next.gpkg >> <<Layer>>';
        const candidates = extractPathCandidates(value, 8, 2);
        assert.strictEqual(candidates.length, 2);
        assertToken(candidates[0], '"model.gpkg"', 9, 2);
        assertToken(candidates[1], '<<Directory>>/next.gpkg', 8 + value.indexOf('<<Directory>>'), 2);
        const layerOnly = extractPathCandidates('first && second', 0, 0);
        assert.strictEqual(layerOnly[0].text, 'first && second');
    });
});

function assertToken(token: GisReferenceToken, text: string, start: number, line: number): void {
    assert.strictEqual(token.text, text);
    assert.strictEqual(token.range.start.line, line);
    assert.strictEqual(token.range.end.line, line);
    assert.strictEqual(token.range.start.character, start);
    assert.strictEqual(token.range.end.character, start + text.length);
}
