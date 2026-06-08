import { SidebarProvider } from "@/components/UI/sidebar"
import { AppSidebar } from "@/components/Core/Layout/app-sidebar"
import Footer, { FooterLinks } from "@/components/Core/Layout/Footer"
import MobileNav from "@/components/Core/Layout/MobileNav"

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <SidebarProvider>
            <div className="flex min-h-svh flex-col w-full">
                <div className="flex h-full">
                    <div className="hidden md:block">
                        <AppSidebar />
                    </div>
                    <main className="flex-1 mb-20 md:mb-20 md:ml-20 overflow-x-hidden">
                        {children}
                        {/* On mobile the nav links live in the page flow, not a fixed
                            footer, so they don't collide with the bottom tab bar. */}
                        <FooterLinks className="md:hidden py-6" />
                    </main>
                </div>
                <MobileNav />
                <Footer />
            </div>
        </SidebarProvider>
    )
}
