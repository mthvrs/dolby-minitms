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
            this.addScrollControls();
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

    addScrollControls() {
        // Remove existing scroll controls if any
        const existing = this.container.querySelector('.macro-scroll-controls');
        if (existing) existing.remove();

        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'macro-scroll-controls';
        scrollContainer.innerHTML = `
            <button class="scroll-btn scroll-up" aria-label="Défiler vers le haut">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
                </svg>
            </button>
            <button class="scroll-btn scroll-down" aria-label="Défiler vers le bas">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                </svg>
            </button>
        `;
        
        this.container.appendChild(scrollContainer);
        
        // Calculate scroll amount: height of one macro group (approximately)
        const groupHeight = 250;
        
        scrollContainer.querySelector('.scroll-up').addEventListener('click', () => {
            this.container.scrollBy({ top: -groupHeight, behavior: 'smooth' });
        });
        
        scrollContainer.querySelector('.scroll-down').addEventListener('click', () => {
            this.container.scrollBy({ top: groupHeight, behavior: 'smooth' });
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