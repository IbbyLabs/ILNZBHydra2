package org.nzbhydra.web;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.annotation.Secured;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

import java.security.Principal;
import java.util.Arrays;

@Controller
public class MainWeb {

    @Value("${ui.frontend-url:http://localhost:3000}")
    private String frontendUrl;

    @RequestMapping(value = "/", method = RequestMethod.GET)
    @Secured({"ROLE_USER"})
    public String index(HttpSession session, Principal principal, HttpServletResponse response) {
        return redirectFrontend("/");
    }

    //Must exist and not be protected so that redirects to "/login" have a target
    @RequestMapping(value = "/login", method = {RequestMethod.GET, RequestMethod.PUT})
    public String index2(HttpSession session, Principal principal) {
        return redirectFrontend("/login");
    }

    @RequestMapping(value = "/config/**", method = RequestMethod.GET)
    @Secured({"ROLE_ADMIN"})
    public String config(HttpServletRequest request, HttpSession session, Principal principal) {
        return redirectFrontend(request.getRequestURI());
    }

    @RequestMapping(value = "/system/**", method = RequestMethod.GET)
    @Secured({"ROLE_ADMIN"})
    public String system(HttpServletRequest request, HttpSession session, Principal principal) {
        return redirectFrontend(request.getRequestURI());
    }

    @RequestMapping(value = "/stats/**", method = RequestMethod.GET)
    @Secured({"ROLE_STATS"})
    public String stats(HttpServletRequest request, HttpSession session, Principal principal) {
        return redirectFrontend(request.getRequestURI());
    }

    @RequestMapping(value = "/search/**", method = RequestMethod.GET)
    @Secured({"ROLE_USER"})
    public String search(HttpServletRequest request, HttpSession session, Principal principal) {
        return redirectFrontend(request.getRequestURI());
    }

    @RequestMapping(value = "/static/index.html", method = RequestMethod.GET)
    public String legacyUiIndex(HttpSession session, Principal principal) {
        return redirectFrontend("/");
    }

    @RequestMapping(value = "/logout", method = RequestMethod.POST)
    public String logout(HttpSession session, Principal principal, HttpServletResponse response) {
        session.setAttribute("LOGGEDOUT", true);
        return redirectFrontend("/login");
    }

    @RequestMapping(value = "/loggedout", method = RequestMethod.POST)
    public String loggedOut(HttpSession session, Principal principal, HttpServletResponse response) {
        if (Boolean.TRUE.equals(session.getAttribute("LOGGEDOUT"))) {
            session.invalidate();
        }
        for (String cookieName : Arrays.asList("remember-me", "JSESSIONID")) {
            Cookie cookie = new Cookie(cookieName, null);

            cookie.setPath("/");
            cookie.setMaxAge(999999);
            cookie.setSecure(true);
            response.addCookie(cookie);

        }
        return redirectFrontend("/login");
    }

    private String redirectFrontend(String path) {
        String normalizedFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
        String normalizedPath = path.startsWith("/") ? path : "/" + path;
        return "redirect:" + normalizedFrontend + normalizedPath;
    }


}
