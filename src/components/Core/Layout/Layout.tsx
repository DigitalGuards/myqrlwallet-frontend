import { SidebarProvider } from "@/components/UI/sidebar"
import { AppSidebar } from "@/components/Core/Layout/app-sidebar"
import Footer from "@/components/Core/Layout/Footer"
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
                    </main>
                </div>
                <MobileNav />
                <Footer />
            </div>
        </SidebarProvider>
    )
}
