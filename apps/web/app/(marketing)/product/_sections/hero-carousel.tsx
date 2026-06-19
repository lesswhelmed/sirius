"use client";

import Image from "next/image";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { SCREEN_SLIDES } from "../../constants";

const INTERVAL_MS = 3500;
const SLIDE_MS = 520;
const LAST = SCREEN_SLIDES.length - 1;

// The hero specimen: real in-app screenshots on a sliding track inside the
// catalog "paper-card" plate. You can DRAG it (mouse or touch) to move between
// screens; it also auto-advances (ping-ponging so there's no jarring jump),
// pauses on hover/drag, and goes still under prefers-reduced-motion. Pure
// React/CSS — no carousel library.
export function HeroCarousel() {
	const [active, setActive] = useState(0);
	const [paused, setPaused] = useState(false);
	const [reducedMotion, setReducedMotion] = useState(false);

	// Live drag state. dragDX is the pixel offset of the in-progress drag; held
	// in state so the track follows the pointer, and in a ref so pointerup can
	// read the final delta without a stale closure.
	const [dragging, setDragging] = useState(false);
	const [dragDX, setDragDX] = useState(0);
	const dragRef = useRef({ startX: 0, dx: 0, width: 0 });

	const viewportRef = useRef<HTMLDivElement | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);
	const dir = useRef(1);

	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReducedMotion(mq.matches);
		const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	// Ping-pong auto-advance: forward to the end, then back — so a sliding track
	// never has to leap from the last screen all the way back to the first.
	const advance = useCallback(() => {
		setActive((prev) => {
			if (prev >= LAST) dir.current = -1;
			else if (prev <= 0) dir.current = 1;
			return Math.min(LAST, Math.max(0, prev + dir.current));
		});
	}, []);

	const stopTimer = useCallback(() => {
		if (timer.current) {
			clearInterval(timer.current);
			timer.current = null;
		}
	}, []);

	useEffect(() => {
		if (reducedMotion || paused || dragging) {
			stopTimer();
			return;
		}
		timer.current = setInterval(advance, INTERVAL_MS);
		return stopTimer;
	}, [advance, paused, dragging, reducedMotion, stopTimer]);

	const goTo = (i: number) => setActive(Math.min(LAST, Math.max(0, i)));

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 && e.pointerType === "mouse") return;
		const width = viewportRef.current?.clientWidth ?? 1;
		dragRef.current = { startX: e.clientX, dx: 0, width };
		setDragging(true);
		setDragDX(0);
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragging) return;
		let dx = e.clientX - dragRef.current.startX;
		// Resistance at the ends so the track can't be dragged into empty space.
		if ((active === 0 && dx > 0) || (active === LAST && dx < 0)) dx *= 0.35;
		dragRef.current.dx = dx;
		setDragDX(dx);
	};

	const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragging) return;
		const { dx, width } = dragRef.current;
		const threshold = Math.max(40, width * 0.18);
		if (dx <= -threshold) goTo(active + 1);
		else if (dx >= threshold) goTo(active - 1);
		setDragging(false);
		setDragDX(0);
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
	};

	const current = SCREEN_SLIDES[active] ?? SCREEN_SLIDES[0];
	const trackStyle = {
		transform: `translate3d(calc(${-active * 100}% + ${dragDX}px), 0, 0)`,
		transition:
			dragging || reducedMotion
				? "none"
				: `transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
	} as const;

	return (
		<figure
			className="paper-card mx-auto w-full max-w-[360px] p-3"
			onMouseEnter={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
		>
			<figcaption className="hairline-b flex items-center justify-between gap-3 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
				<span>Specimen · Demo</span>
				<span className="text-[var(--color-accent)]">
					{current.folio} · {current.label}
				</span>
			</figcaption>

			<div
				ref={viewportRef}
				className="relative mt-3 aspect-[1320/2868] w-full touch-pan-y select-none overflow-hidden bg-[var(--color-paper-sunken)]"
				style={{ cursor: dragging ? "grabbing" : "grab" }}
				role="group"
				aria-roledescription="carousel"
				aria-label="The Sirius app — drag to move between screens"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				<div className="flex h-full w-full" style={trackStyle}>
					{SCREEN_SLIDES.map((slide, i) => (
						<div
							key={slide.folio}
							className="relative h-full w-full shrink-0"
							aria-hidden={i !== active}
						>
							<Image
								src={slide.src}
								alt={slide.alt}
								fill
								sizes="(max-width: 1024px) 80vw, 360px"
								className="pointer-events-none object-cover object-top"
								priority={i === 0}
								draggable={false}
							/>
						</div>
					))}
				</div>
			</div>

			<div
				className="mt-3 flex items-center justify-center gap-2.5"
				role="tablist"
				aria-label="Choose a screen"
			>
				{SCREEN_SLIDES.map((slide, i) => (
					<button
						key={slide.folio}
						type="button"
						role="tab"
						aria-selected={i === active}
						aria-label={`${slide.folio} · ${slide.label}`}
						onClick={() => goTo(i)}
						className="flex h-4 w-4 items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
					>
						<span
							className="block rounded-full transition-all duration-300"
							style={{
								width: i === active ? "7px" : "5px",
								height: i === active ? "7px" : "5px",
								backgroundColor:
									i === active
										? "var(--color-accent)"
										: "var(--color-rule-strong)",
							}}
						/>
					</button>
				))}
			</div>
		</figure>
	);
}
