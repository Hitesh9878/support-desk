/**
 * Mobile Menu Handler for TradeMAV
 * Handles hamburger menu toggle, sidebar overlay, and responsive behavior
 */

(function() {
    'use strict';
    
    let sidebar = null;
    let hamburger = null;
    let overlay = null;
    let isMobile = window.innerWidth <= 768;
    
    function createOverlay() {
        if (document.querySelector('.sidebar-overlay')) return;
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        return overlay;
    }
    
    function closeSidebar() {
        if (!sidebar) return;
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');
        if (hamburger) hamburger.classList.remove('open');
    }
    
    function openSidebar() {
        if (!sidebar) return;
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
        document.body.classList.add('sidebar-open');
        if (hamburger) hamburger.classList.add('open');
    }
    
    function toggleSidebar() {
        if (!sidebar) return;
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }
    
    function handleResize() {
        const wasMobile = isMobile;
        isMobile = window.innerWidth <= 768;
        
        if (!isMobile && wasMobile) {
            closeSidebar();
            if (sidebar) {
                sidebar.style.left = '';
                sidebar.classList.remove('open');
            }
            if (overlay) overlay.classList.remove('active');
            document.body.classList.remove('sidebar-open');
            if (hamburger) hamburger.classList.remove('open');
        } else if (isMobile && !wasMobile) {
            if (sidebar) {
                sidebar.classList.remove('open');
            }
            if (overlay) overlay.classList.remove('active');
            document.body.classList.remove('sidebar-open');
            if (hamburger) hamburger.classList.remove('open');
        }
    }
    
    function closeSidebarOnMobile() {
        if (window.innerWidth <= 768) {
            closeSidebar();
        }
    }
    
    function handleEscapeKey(e) {
        if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    }
    
    function initMobileMenu() {
        sidebar = document.querySelector('.sidebar');
        hamburger = document.getElementById('hamburgerBtn');
        
        if (!sidebar) return;
        
        overlay = createOverlay();
        
        if (!hamburger) {
            const headerLeft = document.querySelector('.header-left');
            if (headerLeft) {
                hamburger = document.createElement('button');
                hamburger.id = 'hamburgerBtn';
                hamburger.className = 'hamburger';
                hamburger.setAttribute('aria-label', 'Menu');
                hamburger.innerHTML = '<span></span><span></span><span></span>';
                headerLeft.insertBefore(hamburger, headerLeft.firstChild);
            }
        }
        
        if (hamburger) {
            hamburger.removeEventListener('click', toggleSidebar);
            hamburger.addEventListener('click', toggleSidebar);
        }
        
        if (overlay) {
            overlay.removeEventListener('click', closeSidebar);
            overlay.addEventListener('click', closeSidebar);
        }
        
        const navLinks = document.querySelectorAll('.sidebar-nav .nav-item');
        navLinks.forEach(link => {
            link.removeEventListener('click', closeSidebarOnMobile);
            link.addEventListener('click', closeSidebarOnMobile);
        });
        
        document.removeEventListener('keydown', handleEscapeKey);
        document.addEventListener('keydown', handleEscapeKey);
        
        window.removeEventListener('resize', handleResize);
        window.addEventListener('resize', handleResize);
        
        handleResize();
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileMenu);
    } else {
        initMobileMenu();
    }
})();