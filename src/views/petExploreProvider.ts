import * as vscode from 'vscode';
import {
	findPetById,
	getPetRootPath,
	listAvailablePets,
	PetDefinition,
} from '../services/petService';
import {
	PetRateLimitSnapshot,
	readPetRateLimits,
} from '../services/petRateLimitService';
import {
	getPetSettings,
	SETTINGS_SECTION,
	updatePetSelectedPetId,
} from '../services/settings';
import { getWorkspaceStatus } from '../services/workspaceStatus';
import {
	CODICON_RESOURCE_ROOTS,
	getCodiconCssHref,
	getWebviewFontFamily,
} from '../services/webviewAssets';

const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const FRAME_COLUMNS = 8;
const BUBBLE_VISIBLE_MS = 5000;
const BASE_RENDER_SCALE = 0.5;

type PetInboundMessage =
	| {
			type: 'stagePositionChanged';
			left: number;
			top: number;
	  };

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function createNonce(): string {
	return Array.from({ length: 24 }, () =>
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
			Math.floor(Math.random() * 62),
		),
	).join('');
}

export class PetExploreProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view?: vscode.WebviewView;
	private refreshTimer?: NodeJS.Timeout;
	private bubbleHideTimer?: NodeJS.Timeout;
	private rateLimits?: PetRateLimitSnapshot;
	private bubbleVisibleUntil = 0;
	private connected = false;
	private stagePosition?: {
		left: number;
		top: number;
	};

	public constructor(private readonly context: vscode.ExtensionContext) {
		void this.updateConnectionContext();
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (
					event.affectsConfiguration(`${SETTINGS_SECTION}.pet`)
					|| event.affectsConfiguration('codexWorkspace.pet')
				) {
					if (!getPetSettings().appServerEnabled) {
						this.connected = false;
						this.disposeRefreshTimer();
						this.disposeBubbleHideTimer();
						this.rateLimits = undefined;
						this.bubbleVisibleUntil = 0;
					} else if (this.connected) {
						void this.refreshRateLimitsIfNeeded(false).finally(() => this.render());
					}
					void this.updateConnectionContext();
					this.render();
				}
			}),
		);
	}

	public resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const petRoot = vscode.Uri.file(getPetRootPath());
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [...CODICON_RESOURCE_ROOTS, petRoot],
		};
		view.webview.onDidReceiveMessage((message: PetInboundMessage) => {
			if (message.type === 'stagePositionChanged') {
				this.stagePosition = {
					left: Math.max(0, Number.isFinite(message.left) ? message.left : 0),
					top: Math.max(0, Number.isFinite(message.top) ? message.top : 0),
				};
			}
		});
		this.render();
	}

	public async selectPet(): Promise<void> {
		const pets = listAvailablePets();
		if (pets.length === 0) {
			vscode.window.showWarningMessage('No valid pets were found under ~/.codex/pets.');
			return;
		}

		const picked = await vscode.window.showQuickPick(
			pets.map((pet) => ({
				label: pet.displayName,
				description: pet.id,
				detail: pet.description,
				pet,
			})),
			{
				placeHolder: 'Select a pet',
			},
		);
		if (!picked) {
			return;
		}

		await updatePetSelectedPetId(picked.pet.id);
		this.render();
	}

	public refresh(): void {
		void this.refreshRateLimitsIfNeeded(true).finally(() => this.render());
	}

	public async setConnection(connected: boolean): Promise<void> {
		this.connected = connected;
		if (!connected) {
			this.rateLimits = undefined;
			this.disposeRefreshTimer();
			this.disposeBubbleHideTimer();
			this.bubbleVisibleUntil = 0;
			void this.updateConnectionContext();
			this.render();
			return;
		}
		await this.refreshRateLimitsIfNeeded(true);
		void this.updateConnectionContext();
		this.render();
	}

	public dispose(): void {
		this.disposeRefreshTimer();
		this.disposeBubbleHideTimer();
	}

	private async refreshRateLimitsIfNeeded(force = false): Promise<void> {
		const settings = getPetSettings();
		if (!settings.appServerEnabled || !this.connected) {
			this.disposeRefreshTimer();
			if (!settings.appServerEnabled) {
				this.rateLimits = undefined;
			}
			return;
		}

		if (force || !this.rateLimits) {
			this.rateLimits = await readPetRateLimits();
			if (this.rateLimits?.windows.length) {
				this.showBubble();
			}
		}

		this.disposeRefreshTimer();
		if (settings.rateLimitRefreshMinutes > 0) {
			this.refreshTimer = setTimeout(() => {
				void this.refreshRateLimitsIfNeeded(true).finally(() => this.render());
			}, settings.rateLimitRefreshMinutes * 60 * 1000);
		}
	}

	private disposeRefreshTimer(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	private disposeBubbleHideTimer(): void {
		if (this.bubbleHideTimer) {
			clearTimeout(this.bubbleHideTimer);
			this.bubbleHideTimer = undefined;
		}
	}

	private scheduleBubbleHide(): void {
		this.disposeBubbleHideTimer();
		const remaining = this.bubbleVisibleUntil - Date.now();
		if (remaining <= 0) {
			this.bubbleVisibleUntil = 0;
			return;
		}
		this.bubbleHideTimer = setTimeout(() => {
			this.bubbleVisibleUntil = 0;
			this.render();
		}, remaining);
	}

	private showBubble(): void {
		this.bubbleVisibleUntil = Date.now() + BUBBLE_VISIBLE_MS;
		this.scheduleBubbleHide();
	}

	private async updateConnectionContext(): Promise<void> {
		await vscode.commands.executeCommand(
			'setContext',
			'codex-workspace.pet.appServer.connected',
			this.connected,
		);
	}

	private render(): void {
		if (!this.view) {
			return;
		}

		const workspaceStatus = getWorkspaceStatus();
		if (!workspaceStatus.isAvailable) {
			this.view.webview.html = this.buildUnavailableHtml(
				workspaceStatus.reason ?? 'Codex Workspace is unavailable.',
			);
			return;
		}

		const settings = getPetSettings();
		const availablePets = listAvailablePets();
		const selectedPet = settings.selectedPetId
			? findPetById(settings.selectedPetId) ?? availablePets[0]
			: availablePets[0];
		if (settings.appServerEnabled && this.connected && !this.rateLimits) {
			void this.refreshRateLimitsIfNeeded(true).finally(() => this.render());
		}
		this.view.webview.html = this.buildHtml(selectedPet, settings.scale);
	}

	private buildUnavailableHtml(reason: string): string {
		const nonce = createNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view?.webview.cspSource ?? ''} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<style>
		body {
			margin: 0;
			padding: 16px;
			font-family: ${getWebviewFontFamily()};
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		.notice {
			padding: 12px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 8px;
			background: var(--vscode-editorWidget-background);
		}
	</style>
</head>
<body>
	<div class="notice">${escapeHtml(reason)}</div>
</body>
</html>`;
	}

	private buildHtml(
		selectedPet: PetDefinition | undefined,
		scale: number,
	): string {
		const nonce = createNonce();
		const webview = this.view?.webview;
		const codiconHref = webview ? getCodiconCssHref(webview) : undefined;
		const spriteHref =
			selectedPet && webview
				? webview.asWebviewUri(vscode.Uri.file(selectedPet.spritesheetFsPath)).toString()
				: '';
		const renderScale = scale * BASE_RENDER_SCALE;
		const initialStageLeft = this.stagePosition?.left ?? 0;
		const initialStageTop = this.stagePosition?.top ?? 0;
		const bubbleMarkup = this.buildRateLimitMarkup();
		const content = selectedPet
			? `<section id="petViewport" class="pet-stage-shell">
					${bubbleMarkup}
					<div id="petStage" class="pet-stage" style="width:${FRAME_WIDTH * renderScale}px;height:${FRAME_HEIGHT * renderScale}px" data-stage-left="${initialStageLeft}" data-stage-top="${initialStageTop}">
						<div class="pet-canvas-shell">
							<canvas
								id="petCanvas"
								width="${FRAME_WIDTH}"
								height="${FRAME_HEIGHT}"
								data-sprite-src="${escapeHtml(spriteHref)}"
								data-frame-width="${FRAME_WIDTH}"
								data-frame-height="${FRAME_HEIGHT}"
								data-frame-columns="${FRAME_COLUMNS}"
								data-default-animation="idle"
							></canvas>
						</div>
					</div>
				</section>`
			: `<section class="empty-state">
					<div class="empty-icon codicon codicon-preview" aria-hidden="true"></div>
					<h3>No pet found</h3>
					<p>Place pet folders under ${escapeHtml(getPetRootPath())}</p>
				</section>`;

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.view?.webview.cspSource ?? ''} data:; style-src ${this.view?.webview.cspSource ?? ''} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	${codiconHref ? `<link rel="stylesheet" href="${codiconHref}" />` : ''}
	<style>
		body {
			margin: 0;
			font-family: ${getWebviewFontFamily()};
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		canvas {
			font: inherit;
		}
		.shell {
			min-height: 100vh;
			padding: 0;
			box-sizing: border-box;
		}
		.pet-stage-shell {
			position: relative;
			width: 100%;
			height: 100vh;
			overflow: hidden;
		}
		.pet-stage {
			position: absolute;
			display: grid;
			place-items: end center;
			user-select: none;
			touch-action: none;
			cursor: grab;
		}
		.pet-stage.dragging {
			cursor: grabbing;
		}
		.pet-canvas-shell {
			display: grid;
			place-items: center;
			width: 100%;
			height: 100%;
			padding: 0;
		}
		canvas {
			display: block;
			image-rendering: pixelated;
			width: 100%;
			height: 100%;
		}
		.bubble {
			position: absolute;
			max-width: min(220px, 58vw);
			display: grid;
			gap: 8px;
			padding: 10px 12px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 12px;
			background: var(--vscode-editorWidget-background);
			box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);
			font-size: 12px;
			animation: bubbleAppear 180ms ease-out;
			pointer-events: none;
			z-index: 2;
		}
		.bubble::after {
			content: "";
			position: absolute;
			width: 14px;
			height: 14px;
			background: var(--vscode-editorWidget-background);
			transform: rotate(45deg);
		}
		.bubble[data-side="right"][data-vertical="top"]::after {
			left: 18px;
			bottom: -8px;
			border-right: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.bubble[data-side="left"][data-vertical="top"]::after {
			right: 18px;
			bottom: -8px;
			border-right: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.bubble[data-side="right"][data-vertical="bottom"]::after {
			left: 18px;
			top: -8px;
			border-left: 1px solid var(--vscode-panel-border);
			border-top: 1px solid var(--vscode-panel-border);
		}
		.bubble[data-side="left"][data-vertical="bottom"]::after {
			right: 18px;
			top: -8px;
			border-left: 1px solid var(--vscode-panel-border);
			border-top: 1px solid var(--vscode-panel-border);
		}
		.rate-card {
			display: grid;
			gap: 4px;
		}
		.rate-meta {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 8px;
			font-size: 12px;
		}
		.rate-label {
			font-weight: 600;
		}
		.rate-reset {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}
		.rate-bar {
			height: 8px;
			border-radius: 999px;
			background: var(--vscode-input-background);
			overflow: hidden;
		}
		.rate-bar-fill {
			height: 100%;
			background: var(--vscode-testing-iconPassed, #5dad79);
		}
		.rate-bar-fill.warning {
			background: #d85b74;
		}
		.empty-state {
			margin: 16px;
			padding: 18px 14px;
			display: grid;
			gap: 8px;
			justify-items: center;
			text-align: center;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 8px;
			background: var(--vscode-editorWidget-background);
		}
		.empty-state h3 {
			margin: 0;
		}
		.empty-state p {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			line-height: 1.5;
		}
		.empty-icon {
			font-size: 28px;
			color: var(--vscode-descriptionForeground);
		}
		.rate-empty {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
		@keyframes bubbleAppear {
			0% {
				opacity: 0;
				transform: translateY(6px) scale(0.98);
			}
			100% {
				opacity: 1;
				transform: translateY(0) scale(1);
			}
		}
	</style>
</head>
<body>
		<div class="shell">
			${content}
		</div>
		<script nonce="${nonce}">
		const viewport = document.getElementById('petViewport');
		const stage = document.getElementById('petStage');
		const canvas = document.getElementById('petCanvas');
		const bubble = document.getElementById('rateLimitBubble');
		const vscode = acquireVsCodeApi();
		if (
			viewport instanceof HTMLElement
			&& stage instanceof HTMLElement
			&& canvas instanceof HTMLCanvasElement
		) {
			const context = canvas.getContext('2d');
			const spriteSrc = canvas.dataset.spriteSrc;
			const frameWidth = Number(canvas.dataset.frameWidth);
			const frameHeight = Number(canvas.dataset.frameHeight);
			const frameColumns = Number(canvas.dataset.frameColumns);
			if (context && spriteSrc) {
				const image = new Image();
				image.onload = () => {
					const probe = document.createElement('canvas');
					probe.width = image.width;
					probe.height = image.height;
					const probeContext = probe.getContext('2d', { willReadFrequently: true });
					if (!probeContext) {
						return;
					}
					probeContext.drawImage(image, 0, 0);
					const rowBounds = Array.from(
						{ length: Math.max(1, Math.round(image.height / frameHeight)) },
						(_, row) => ({
							top: row * frameHeight,
							bottom: Math.min(image.height - 1, ((row + 1) * frameHeight) - 1),
						}),
					);
					const framesByRow = Array.from({ length: rowBounds.length }, () => []);
					for (let row = 0; row < rowBounds.length; row += 1) {
						const bounds = rowBounds[row];
						const sourceHeight = Math.max(1, bounds.bottom - bounds.top + 1);
						for (let column = 0; column < frameColumns; column += 1) {
							const sx = column * frameWidth;
							const sy = bounds.top;
							if (sx + frameWidth > image.width || sy + sourceHeight > image.height) {
								continue;
							}
							const pixels = probeContext.getImageData(sx, sy, frameWidth, sourceHeight).data;
							let minX = frameWidth;
							let minY = sourceHeight;
							let maxX = -1;
							let maxY = -1;
							for (let y = 0; y < sourceHeight; y += 1) {
								for (let x = 0; x < frameWidth; x += 1) {
									const alpha = pixels[((y * frameWidth) + x) * 4 + 3];
									if (alpha > 8) {
										if (x < minX) {
											minX = x;
										}
										if (y < minY) {
											minY = y;
										}
										if (x > maxX) {
											maxX = x;
										}
										if (y > maxY) {
											maxY = y;
										}
									}
								}
							}
							if (maxX >= minX && maxY >= minY) {
								framesByRow[row].push({
									sx,
									sy,
									row,
									cropLeft: minX,
									cropTop: minY,
									cropWidth: (maxX - minX) + 1,
									cropHeight: (maxY - minY) + 1,
								});
							}
						}
					}
					const allFrames = framesByRow.flat();
					if (allFrames.length === 0) {
						return;
					}
					const animationRows = {
						idle: [0],
						dragLeft: [2],
						dragRight: [1],
						click: [3],
						wait: [6],
					};
					const resolveFrames = (animation) => {
						for (const row of animationRows[animation] ?? []) {
							if (framesByRow[row] && framesByRow[row].length > 0) {
								return framesByRow[row];
							}
						}
						return framesByRow[0]?.length > 0 ? framesByRow[0] : allFrames;
					};
					let currentAnimation = 'idle';
					let animationUntil = 0;
					let lastInteractionAt = Date.now();
					let index = 0;
					let dragState = null;
					let facingDirection = 'right';

					const updateBubblePosition = () => {
						if (!(bubble instanceof HTMLElement)) {
							return;
						}
						const horizontalGap = Math.min(12, Math.max(4, Math.round(stage.offsetWidth * 0.045)));
						const verticalGap = Math.min(10, Math.max(4, Math.round(stage.offsetHeight * 0.04)));
						const anchorX = stage.offsetLeft + Math.round(stage.offsetWidth * 0.65);
						const anchorY = stage.offsetTop + Math.round(stage.offsetHeight * 0.3);
						const bubbleWidth = bubble.offsetWidth;
						const bubbleHeight = bubble.offsetHeight;
						const margin = 8;
						const spaceRight = viewport.clientWidth - anchorX - horizontalGap;
						const spaceLeft = anchorX - horizontalGap;
						const side = spaceRight >= bubbleWidth || spaceRight >= spaceLeft
							? 'right'
							: 'left';
						const spaceTop = anchorY - verticalGap;
						const spaceBottom = viewport.clientHeight - anchorY - verticalGap;
						const vertical = spaceTop >= bubbleHeight || spaceTop >= spaceBottom
							? 'top'
							: 'bottom';
						const desiredLeft = side === 'right'
							? anchorX + horizontalGap
							: anchorX - bubbleWidth - horizontalGap;
						const desiredTop = vertical === 'top'
							? anchorY - bubbleHeight - verticalGap
							: anchorY + verticalGap;
						const clampedLeft = Math.min(
							viewport.clientWidth - bubbleWidth - 8,
							Math.max(8, desiredLeft),
						);
						const clampedTop = Math.min(
							viewport.clientHeight - bubbleHeight - 8,
							Math.max(8, desiredTop),
						);
						bubble.dataset.side = side;
						bubble.dataset.vertical = vertical;
						bubble.style.left = clampedLeft + 'px';
						bubble.style.top = clampedTop + 'px';
					};

					const setStagePosition = (left, top) => {
						const maxLeft = Math.max(0, viewport.clientWidth - stage.offsetWidth);
						const maxTop = Math.max(0, viewport.clientHeight - stage.offsetHeight);
						const nextLeft = Math.min(Math.max(0, left), maxLeft);
						const nextTop = Math.min(Math.max(0, top), maxTop);
						stage.style.left = nextLeft + 'px';
						stage.style.top = nextTop + 'px';
						vscode.postMessage({
							type: 'stagePositionChanged',
							left: nextLeft,
							top: nextTop,
						});
						updateBubblePosition();
					};

					const placeDefaultStage = () => {
						const savedLeft = Number(stage.dataset.stageLeft);
						const savedTop = Number(stage.dataset.stageTop);
						if (Number.isFinite(savedLeft) && Number.isFinite(savedTop) && (savedLeft > 0 || savedTop > 0)) {
							setStagePosition(savedLeft, savedTop);
							return;
						}
						const defaultLeft = (viewport.clientWidth - stage.offsetWidth) / 2;
						const defaultTop = viewport.clientHeight - stage.offsetHeight - 12;
						setStagePosition(defaultLeft, defaultTop);
					};

					const setAnimation = (nextAnimation, durationMs = 0) => {
						currentAnimation = nextAnimation;
						animationUntil = durationMs > 0 ? Date.now() + durationMs : 0;
						index = 0;
					};

					const draw = () => {
						if (
							currentAnimation !== 'dragLeft'
							&& currentAnimation !== 'dragRight'
							&& animationUntil > 0
							&& Date.now() > animationUntil
						) {
							currentAnimation = 'idle';
							animationUntil = 0;
							index = 0;
						}
						if (
							currentAnimation === 'idle'
							&& Date.now() - lastInteractionAt > 6000
						) {
							currentAnimation = 'wait';
						}
						if (
							currentAnimation === 'wait'
							&& Date.now() - lastInteractionAt <= 6000
						) {
							currentAnimation = 'idle';
						}
						const playback = resolveFrames(currentAnimation);
						const frame = playback[index % playback.length];
						context.clearRect(0, 0, canvas.width, canvas.height);
						const drawWidth = frame.cropWidth;
						const drawHeight = frame.cropHeight;
						const dx = Math.round((canvas.width - drawWidth) / 2);
						const dy = Math.max(0, canvas.height - drawHeight);
						context.drawImage(
							image,
							frame.sx + frame.cropLeft,
							frame.sy + frame.cropTop,
							frame.cropWidth,
							frame.cropHeight,
							dx,
							dy,
							drawWidth,
							drawHeight,
						);
						index = (index + 1) % playback.length;
					};

					const beginInteraction = () => {
						lastInteractionAt = Date.now();
						if (currentAnimation === 'wait') {
							setAnimation('idle');
						}
					};

					const onPointerMove = (event) => {
						if (!dragState) {
							return;
						}
						event.preventDefault();
						const deltaX = event.clientX - dragState.startX;
						const deltaY = event.clientY - dragState.startY;
						if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
							dragState.moved = true;
							if (deltaX < -1) {
								facingDirection = 'left';
							} else if (deltaX > 1) {
								facingDirection = 'right';
							}
							setAnimation(
								facingDirection === 'left' ? 'dragLeft' : 'dragRight',
							);
						}
						if (dragState.moved) {
							setStagePosition(
								dragState.originLeft + deltaX,
								dragState.originTop + deltaY,
							);
						}
					};

					const finishPointer = () => {
						if (!dragState) {
							return;
						}
						stage.classList.remove('dragging');
						const moved = dragState.moved;
						dragState = null;
						window.removeEventListener('pointermove', onPointerMove);
						window.removeEventListener('pointerup', finishPointer);
						window.removeEventListener('pointercancel', finishPointer);
						beginInteraction();
						if (moved) {
							setAnimation('idle', 120);
							return;
						}
						setAnimation('click', 900);
					};

					const startDrag = (event) => {
						event.preventDefault();
						beginInteraction();
						const rect = stage.getBoundingClientRect();
						dragState = {
							startX: event.clientX,
							startY: event.clientY,
							originLeft: rect.left - viewport.getBoundingClientRect().left,
							originTop: rect.top - viewport.getBoundingClientRect().top,
							moved: false,
						};
						stage.classList.add('dragging');
						window.addEventListener('pointermove', onPointerMove);
						window.addEventListener('pointerup', finishPointer);
						window.addEventListener('pointercancel', finishPointer);
					};
					stage.addEventListener('pointerdown', startDrag);
					canvas.style.pointerEvents = 'none';

					let animationTimer = 0;
					const scheduleNextFrame = (delay = 220) => {
						window.clearTimeout(animationTimer);
						animationTimer = window.setTimeout(() => {
							if (document.hidden) {
								return;
							}
							draw();
								scheduleNextFrame(
									currentAnimation === 'dragLeft' || currentAnimation === 'dragRight'
										? 120
										: 240,
								);
							}, delay);
						};

					window.addEventListener('resize', () => {
						placeDefaultStage();
						updateBubblePosition();
					});
					document.addEventListener('visibilitychange', () => {
						if (document.hidden) {
							window.clearTimeout(animationTimer);
							return;
						}
						scheduleNextFrame(240);
					});
					window.addEventListener('beforeunload', () => {
						window.clearTimeout(animationTimer);
						window.removeEventListener('pointermove', onPointerMove);
						window.removeEventListener('pointerup', finishPointer);
						window.removeEventListener('pointercancel', finishPointer);
					});

					placeDefaultStage();
					updateBubblePosition();
					draw();
					scheduleNextFrame(240);
				};
				image.src = spriteSrc;
			}
		}
	</script>
</body>
</html>`;
	}

	private buildRateLimitMarkup(): string {
		if (!getPetSettings().appServerEnabled) {
			return '';
		}
		if (!this.connected) {
			return '';
		}
		if (!this.rateLimits || this.rateLimits.windows.length === 0) {
			return '';
		}
		if (Date.now() >= this.bubbleVisibleUntil) {
			return '';
		}
		const rows = this.rateLimits.windows
			.map(
				(window) => `<article class="rate-card">
					<div class="rate-meta">
						<span class="rate-label">${window.label}</span>
						<span>${window.remainingPercent}%</span>
					</div>
					<div class="rate-reset">reset ${window.resetAtLabel}</div>
					<div class="rate-bar">
						<div class="rate-bar-fill ${window.isWarning ? 'warning' : ''}" style="width:${window.remainingPercent}%"></div>
					</div>
				</article>`,
			)
			.join('');
		return `<div id="rateLimitBubble" class="bubble" data-side="right" data-vertical="top">${rows}</div>`;
	}
}
