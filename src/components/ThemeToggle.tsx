import {useTheme} from "../context/ThemeContext";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  console.log(theme);
  return (
    <button onClick={toggleTheme} className="toggleTheme">
      {theme === "light" ? <Moon /> : <Sun />}
    </button>
  );
}