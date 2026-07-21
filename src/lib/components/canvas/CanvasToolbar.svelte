<nav
	class="absolute top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-stone-200 bg-white p-1.5 shadow-sm"
	aria-label="Canvas tools"
>
	<button
		class="grid size-9 place-items-center rounded-lg bg-stone-950 text-white"
		type="button"
		aria-label="Select"
		title="Select"
	>
		<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8">
			<path d="m5 3 13 8-6 2-3 6L5 3Z"></path>
		</svg>
	</button>
	<button
		class="grid size-9 place-items-center rounded-lg text-stone-600 hover:bg-stone-100"
		type="button"
		aria-label="Add box"
		title="Add box"
	>
		<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8">
			<rect x="4" y="5" width="16" height="14" rx="2"></rect>
			<path d="M12 9v6M9 12h6"></path>
		</svg>
	</button>
	<button
		class="grid size-9 place-items-center rounded-lg text-stone-600 hover:bg-stone-100"
		type="button"
		aria-label="Connect boxes"
		title="Connect boxes"
	>
		<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8">
			<circle cx="6" cy="12" r="2.5"></circle>
			<circle cx="18" cy="12" r="2.5"></circle>
			<path d="M8.5 12h7"></path>
		</svg>
	</button>
</nav>
