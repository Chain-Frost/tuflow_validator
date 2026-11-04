/** Conservative state for TUFLOW's control-file-local and TCF-global databases. */
export type DatabaseSelection =
    | { kind: 'database'; filePath: string }
    | { kind: 'none' }
    | { kind: 'unknown'; reason: string };

interface GlobalDatabaseState {
    selection: DatabaseSelection;
    generation: number;
}

export class SpatialDatabaseScope {
    private local: { selection: DatabaseSelection; generation: number } | undefined;

    private constructor(private readonly global: GlobalDatabaseState, readonly isTcf: boolean) {}

    static root(isTcf: boolean): SpatialDatabaseScope {
        return new SpatialDatabaseScope({
            selection: isTcf ? { kind: 'none' } : {
                kind: 'unknown', reason: 'the parent TCF database context is not available'
            },
            generation: 0
        }, isTcf);
    }

    child(isTcf: boolean, inline: boolean): SpatialDatabaseScope {
        if (inline) {
            return this;
        }
        if (isTcf) {
            return SpatialDatabaseScope.root(true);
        }
        return new SpatialDatabaseScope(this.global, false);
    }

    active(): DatabaseSelection {
        if (this.local?.generation === this.global.generation) {
            return this.local.selection;
        }
        return this.global.selection;
    }

    assign(selection: DatabaseSelection): void {
        if (this.isTcf) {
            this.global.selection = selection;
        } else {
            this.local = { selection, generation: this.global.generation };
        }
    }

    useTcf(): void {
        this.local = undefined;
    }

    off(): void {
        // OFF is global, including when issued from a local control file.
        this.global.selection = { kind: 'none' };
        this.global.generation++;
    }

    uncertain(reason: string, global = false): void {
        const selection: DatabaseSelection = { kind: 'unknown', reason };
        if (global) {
            // An unknown include/conditional OFF may affect any active scope.
            this.global.selection = selection;
            this.global.generation++;
        } else {
            this.assign(selection);
        }
    }
}
