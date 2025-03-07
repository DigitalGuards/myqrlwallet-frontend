export default function Footer() {
    return (
        <footer className="fixed bottom-0 md:border-t-2 border-t-secondary border-t-opacity-50 bg-background w-full z-10 h-6 md:h-10 flex items-center justify-center md:justify-start md:px-4 md:pl-12 gap-12">
            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Home
            </button>
            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy
            </button>
            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Teams
            </button>
            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Support
            </button>
        </footer>
    )
}
