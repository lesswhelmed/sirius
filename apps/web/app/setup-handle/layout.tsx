export default function SetupHandleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full text-[var(--fg)]">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
        {children}
      </div>
    </div>
  );
}
