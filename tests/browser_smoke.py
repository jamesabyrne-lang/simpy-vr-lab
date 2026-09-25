import subprocess
import time

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By


def fail_with_diagnostics(driver, message, logs):
    print("BADGE:", driver.find_element(By.ID, "engineBadge").text)
    print("STATUS:", driver.find_element(By.ID, "statusText").text)
    print("BROWSER LOG:")
    for entry in logs + driver.get_log("browser"):
        print(entry)
    raise RuntimeError(message)


def main():
    server = subprocess.Popen(
        ["python", "-m", "http.server", "8000", "--bind", "127.0.0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(1)
        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1440,1000")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        try:
            driver.get("http://127.0.0.1:8000/")
            deadline = time.time() + 240
            seen_logs = []
            while time.time() < deadline:
                badge = driver.find_element(By.ID, "engineBadge").text
                status = driver.find_element(By.ID, "statusText").text
                new_logs = driver.get_log("browser")
                seen_logs.extend(new_logs)
                severe = [e for e in new_logs if e.get("level") == "SEVERE"]
                syntax = [e for e in severe if "SyntaxError" in e.get("message", "")]
                if syntax:
                    fail_with_diagnostics(driver, "Browser JavaScript syntax error", seen_logs)
                if badge == "Load failed":
                    fail_with_diagnostics(driver, "Pyodide/SimPy runtime reported load failure", seen_logs)
                if badge == "SimPy ready" and "arrivals" in status.lower():
                    break
                time.sleep(2)
            else:
                fail_with_diagnostics(driver, "Browser runtime did not become ready", seen_logs)

            assert driver.find_element(By.ID, "runButton").is_enabled()
            assert driver.find_element(By.ID, "sceneCanvas").is_displayed()
            assert int(driver.find_element(By.ID, "kpiInSystem").text) >= 0
        finally:
            driver.quit()
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    main()
