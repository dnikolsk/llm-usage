import './globals.css';
export const metadata={title:'Usage',description:'Subscription capacity, resets, and worker readiness.',appleWebApp:{capable:true,title:'Usage',statusBarStyle:'default'}};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:[{media:'(prefers-color-scheme: light)',color:'#f4f4f1'},{media:'(prefers-color-scheme: dark)',color:'#0e0f11'}]};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
