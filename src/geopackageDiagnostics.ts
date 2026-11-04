import * as path from 'path';
import * as vscode from 'vscode';
import { createTpvDiagnostic, TPV_CODES } from './diagnosticCodes';
import { InventoryResult } from './geopackageInventory';
import { expandStaticVariables } from './staticVariables';

export interface LayerSelector {
    text: string;
    range: vscode.Range;
}

/** SQLite identifier comparison folds ASCII only, not locale-dependent Unicode. */
function foldName(value: string): string {
    return value.replace(/[A-Z]/g, character => character.toLowerCase());
}

export function addUncheckedDatabaseDiagnostic(
    diagnostics: vscode.Diagnostic[], range: vscode.Range, reason: string
): void {
    diagnostics.push(createTpvDiagnostic(range,
        `GeoPackage layers not checked: ${reason}.`,
        vscode.DiagnosticSeverity.Information, TPV_CODES.unresolvedDatabase));
}

export async function checkGeoPackageLayers(
    filePath: string,
    selectors: LayerSelector[],
    range: vscode.Range,
    variables: ReadonlyMap<string, string>,
    diagnostics: vscode.Diagnostic[],
    inspect: (filePath: string) => Promise<InventoryResult>,
    inventoryOnly = false
): Promise<void> {
    const concrete: LayerSelector[] = [];
    for (const selector of selectors) {
        const text = expandStaticVariables(selector.text, variables);
        // A runtime layer cannot be checked. Its physical file is handled independently.
        if (text !== null && text.trim() && !/[|]|&&|>>|<</.test(text)) {
            concrete.push({ text: text.trim(), range: selector.range });
        }
    }
    if (!inventoryOnly && concrete.length === 0) {
        return;
    }

    const inventory = await inspect(filePath);
    if (inventory.status !== 'ok') {
        diagnostics.push(createTpvDiagnostic(range,
            `GeoPackage layers not checked in ${filePath}: ${inventory.reason}.`,
            vscode.DiagnosticSeverity.Warning, inventory.reasonCode === 'empty'
                ? TPV_CODES.emptyGeoPackage : TPV_CODES.unreadableGeoPackage));
        return;
    }
    if (inventory.layers.length === 0) {
        diagnostics.push(createTpvDiagnostic(range,
            `GeoPackage has no registered spatial layers: ${filePath}.`,
            vscode.DiagnosticSeverity.Warning, TPV_CODES.emptyGeoPackage));
        return;
    }
    if (inventoryOnly) {
        return;
    }
    const available = new Set(inventory.layers.map(foldName));
    const displayed = inventory.layers.slice(0, 12).join(', ').slice(0, 300);
    const suffix = inventory.layers.length > 12 || inventory.layers.slice(0, 12).join(', ').length > 300
        ? ' …' : '';
    const seen = new Set<string>();
    for (const selector of concrete) {
        if (/^USE\s+ALL$/i.test(selector.text)) {
            continue;
        }
        const name = foldName(selector.text);
        if (available.has(name) || seen.has(name)) {
            continue;
        }
        seen.add(name);
        diagnostics.push(createTpvDiagnostic(selector.range,
            `Layer "${selector.text}" not found in GeoPackage ${filePath}. Available layers: ${displayed}${suffix}.`,
            vscode.DiagnosticSeverity.Error, TPV_CODES.missingGeoPackageLayer));
    }
}

export function implicitLayer(filePath: string, range: vscode.Range): LayerSelector {
    return { text: path.basename(filePath, path.extname(filePath)), range };
}
