class MacroPanel {
    constructor(container, theaterName) {
        this.container = container;
        this.theaterName = theaterName;
        this.macros = [];
    }

    async load() {
        try {
            const response = await api.getMacros(this.theaterName);
            this.macros = response.macros;
            this.render();
        } catch (error) {
            this.container.innerHTML = '<div class="loading">Erreur chargement macros</div>';
        }
    }

    render() {
        if (!this.macros || this.macros.length === 0) {
            this.container.innerHTML = '<div class="loading">Aucune macro disponible</div>';
            return;
        }

        let html = '';
        for (const group of this.macros) {
            html += `
                <div class="macro-group">
                    <div class="group-header">
                        <h3 class="group-title">${group.group}</h3>
                    </div>
                    <div class="macro-buttons">
                        ${group.controls.map(control => `
                            <button 
                                class="macro-btn ${this.isEmergency(control.display) ? 'emergency' : ''}"
                                data-macro-name="${control.name}"
                                data-display-name="${control.display}"
                            >
                                ${control.display}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        this.container.innerHTML = html;

        // Attach event listeners
        this.container.querySelectorAll('.macro-btn').forEach(btn => {
            btn.addEventListener('click', () => this.handleMacroClick(btn));
        });
    }

    isEmergency(displayText) {
        return displayText.includes('!') || displayText.toUpperCase().includes('URG');
    }

    handleMacroClick(btn) {
        const macroName = btn.dataset.macroName;
        const displayName = btn.dataset.displayName;
        
        // Check lock mode for execution strategy
        if (app.lockMode === 'instant') {
            // No confirmation needed (Pulsating Orange Mode)
            this.executeMacro(btn, macroName, displayName);
        } else {
            // Confirmation needed (Green Mode - default)
            app.showConfirmation(displayName, async (confirmed) => {
                if (confirmed) {
                    await this.executeMacro(btn, macroName, displayName);
                }
            });
        }
    }

    async executeMacro(btn, macroName, displayName) {
        const originalClass = btn.className;
        btn.classList.add('executing');

        try {
            const response = await api.executeMacro(this.theaterName, macroName, displayName);
            
            if (response.success) {
                btn.className = originalClass.replace('executing', 'success');
                setTimeout(() => {
                    btn.className = originalClass;
                }, 600);
            } else {
                btn.className = originalClass.replace('executing', 'error');
                setTimeout(() => {
                    btn.className = originalClass;
                }, 1200);
            }
        } catch (error) {
            btn.className = originalClass.replace('executing', 'error');
            setTimeout(() => {
                btn.className = originalClass;
            }, 1200);
        }
    }
}