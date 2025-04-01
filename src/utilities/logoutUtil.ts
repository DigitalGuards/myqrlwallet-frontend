import { ROUTES } from "@/router/router";

/**
 * A utility function to handle logout by clearing 
 * all locally stored data and redirecting to the home page.
 * 
 * @param navigate - The navigate function from react-router
 */
export const handleLogout = (navigate: (path: string) => void) => {
    // Clear local storage
    localStorage.clear();
    
    // Navigate to homepage
    navigate(ROUTES.HOME);
    
    // Reload the application to reset all state
    window.location.reload();
}; 