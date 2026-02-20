const appContainer = document.getElementById('app-container');
const errorLog = document.getElementById('error-log');
const players = [];

const logger = {
    log: (msg) => console.log(`[Cams] ${msg}`),
    error: (msg) => {
        console.error(`[Cams] ${msg}`);
        if (errorLog) {
            errorLog.style.display = 'block';
            errorLog.textContent = msg;
        }
    }
};

const TARGET_AR = 1.777;
const TOLERANCE = 0.10;
const MIN_AR = TARGET_AR * (1 - TOLERANCE);
const MAX_AR = TARGET_AR * (1 + TOLERANCE);

document.getElementById('reload-btn').addEventListener('click', () => window.location.reload());
document.getElementById('restart-btn').addEventListener('click', async () => {
    if (confirm('Redémarrer le serveur ?')) {
        try {
            await api.restartService();
            setTimeout(() => window.location.reload(), 5000);
        }
        catch (err) { alert('Échec: ' + err.message); }
    }
});

async function init() {
    try {
        const data = await api.getTheaters();
        const allTheaters = data.theaters || [];
        if (allTheaters.length === 0) return logger.error("Aucune salle trouvée");

        const urlParams = new URLSearchParams(window.location.search);
        const requestedIndices = [];
        for (const key of urlParams.keys()) {
            const num = parseInt(key);
            if (!isNaN(num) && num > 0) requestedIndices.push(num - 1);
        }

        let targets = [], targetIndices = [];
        if (requestedIndices.length > 0) {
            requestedIndices.forEach(idx => {
                if (idx < allTheaters.length) {
                    targets.push(allTheaters[idx]);
                    targetIndices.push(idx + 1);
                }
            });
        } else {
            targets = allTheaters.slice(0, 3);
            targetIndices = [1, 2, 3].slice(0, targets.length);
        }

        targets.forEach((t, arrIndex) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'cam-wrapper';
            appContainer.appendChild(wrapper);
            const feed = new MultiviewFeed(wrapper, t.slug, t.name, targetIndices[arrIndex], arrIndex === 0, logger);
            feed.start();
            players.push({ wrapper, feed });
        });

        window.addEventListener('resize', calculateLayout);
        calculateLayout();
    } catch (err) { logger.error(`Erreur: ${err.message}`); }
}

function calculateLayout() {
    if (players.length === 0) return;
    const W = window.innerWidth, H = window.innerHeight, count = players.length;
    const hSlotW = W / count, hValid = getSquishedDimensions(hSlotW, H), hTotalArea = hValid.area * count;
    const vSlotH = H / count, vValid = getSquishedDimensions(W, vSlotH), vTotalArea = vValid.area * count;
    const bestLayout = (hTotalArea >= vTotalArea) ? 'horizontal' : 'vertical';
    const finalDims = (hTotalArea >= vTotalArea) ? hValid : vValid;

    appContainer.style.flexDirection = (bestLayout === 'horizontal') ? 'row' : 'column';
    appContainer.style.width = (bestLayout === 'horizontal') ? '100vw' : `${finalDims.w}px`;
    appContainer.style.height = (bestLayout === 'vertical') ? '100vh' : `${finalDims.h}px`;

    players.forEach(p => {
        p.wrapper.style.width = `${finalDims.w}px`;
        p.wrapper.style.height = `${finalDims.h}px`;
    });
}

function getSquishedDimensions(slotW, slotH) {
    const slotAR = slotW / slotH;
    if (slotAR >= MIN_AR && slotAR <= MAX_AR) return { w: slotW, h: slotH, area: slotW * slotH };
    if (slotAR < MIN_AR) { const h = slotW / MIN_AR; return { w: slotW, h: h, area: slotW * h }; }
    if (slotAR > MAX_AR) { const w = slotH * MAX_AR; return { w: w, h: slotH, area: w * slotH }; }
    return { w: slotW, h: slotH, area: 0 };
}

init();
