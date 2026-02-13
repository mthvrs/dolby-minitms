# Visibility Improvements for 7-Inch Screens

## Summary

Cette branche apporte des améliorations significatives pour les écrans 7 pouces et les petites surfaces tactiles.

## Changements Implementés

### 1. Nettoyage automatique des titres SPL
- **Fichiers modifiés**: `public/js/components/playbackTimeline.js`
- **Fonctionnalité**: Retrait automatique des préfixes de date au format `YYMMDD ` au début des titres SPL
- **Exemple**: "260215 Mon Film" devient "Mon Film"
- La fonction `cleanSplTitle()` utilise l'année en cours pour détecter dynamiquement les préfixes

### 2. Priorisation SPL > CPL
- **Fichiers modifiés**: `public/css/timeline.css`
- Le titre SPL ne sera jamais tronqué (priorité absolue)
- Le titre CPL peut être coupé avec ellipse si nécessaire
- CSS: `.spl-title { flex-shrink: 0; }` et `.cpl-title { text-overflow: ellipsis; }`

### 3. Améliorations de visibilité pour écrans 7 pouces

#### Titres SPL
- Taille augmentée: `1.2em` → `1.8em`
- Poids de police augmenté: `700` → `800`

#### Timeline (barre de progression)
- Épaisseur augmentée: `8px` → `14px`
- Rayon de bordure adapté: `4px` → `7px`

#### Minuteurs (temps écoulé, restant, fin)
- Taille augmentée: `1.1em` → `1.8em` (!)
- Poids de police augmenté: `700` → `800`
- Labels augmentés: `0.75em` → `0.85em`
- Espacement augmenté: `1rem` → `1.5rem`
- Padding augmenté: `0.75rem` → `1rem`

#### Icônes de statut (play/pause/stop)
- Taille augmentée: `14px` → `28px` (double!)
- Opacité augmentée: `0.6` → `0.9`
- Ajout d'un effet de lueur: `drop-shadow(0 0 4px currentColor)`

### 4. Boutons de scroll pour macros
- **Fichiers modifiés**: `public/css/style.css`, `public/js/components/macroPanel.js`
- Ajout de 2 gros boutons flèche (haut/bas) sur les écrans tablettes (601px-1023px)
- Taille des boutons: `60px × 60px`
- Position: fixe en bas à droite
- Scroll automatique d'un groupe de macros par clic
- Non affiché sur smartphones et iPads (détection automatique)

### 5. Header plus lisible sur petits écrans
- **Fichiers modifiés**: `public/css/style.css`
- Pour écrans < 800px:
  - Taille des onglets augmentée avec poids plus élevé (700)
  - Zone tactile minimum: `44px` (standard iOS)
  - Boutons de thème plus grands: `44px × 44px`
  - Espacement optimisé

### 6. Application sur toutes les interfaces
- **Page principale**: ✓
- **Pages dédiées aux macros**: ✓
- **Flux /cams**: En attente de validation pour la mise à jour complète

## Fichiers Modifiés

1. `public/js/components/playbackTimeline.js` - Fonction cleanSplTitle + utilisation
2. `public/css/timeline.css` - Améliorations visibilité 7 pouces
3. `public/css/style.css` - Scroll controls + header améliorations
4. `public/js/components/macroPanel.js` - Implémentation scroll controls

## Tests Recommandés

- [ ] Tester sur écran 7 pouces
- [ ] Vérifier que les titres SPL avec date "260215 xxx" sont bien nettoyés
- [ ] Vérifier que le CPL est coupé en priorité, pas le SPL
- [ ] Tester les boutons de scroll sur tablette
- [ ] Vérifier que les minuteurs sont très lisibles
- [ ] Tester le header sur petit écran

## Compatibilité

- Navigateurs modernes (Chrome, Firefox, Safari, Edge)
- Responsive: mobile, tablette, desktop
- Support touch optimisé
