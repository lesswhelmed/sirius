"use client";

import { useEffect, useRef, useState } from "react";

// A quiet on-enter reveal: content fades and lifts a few pixels the first time
// it scrolls into view. IntersectionObserver, no library. Honors
// prefers-reduced-motion (renders fully visible, no transform) and degrades to
// always-visible if IO is unavailable, so nothing is ever hidden without JS.
export function Reveal({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [shown, setShown] = useState(false);
	const [animate, setAnimate] = useState(false);

	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setShown(true);
			return;
		}
		setAnimate(true);
		const el = ref.current;
		if (!el || typeof IntersectionObserver === "undefined") {
			setShown(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setShown(true);
						observer.disconnect();
					}
				}
			},
			{ rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={ref}
			className={className}
			style={
				animate
					? {
							opacity: shown ? 1 : 0,
							transform: shown ? "none" : "translateY(16px)",
							transition: "opacity 700ms ease-out, transform 700ms ease-out",
							willChange: "opacity, transform",
						}
					: undefined
			}
		>
			{children}
		</div>
	);
}
