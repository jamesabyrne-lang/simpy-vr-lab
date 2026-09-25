import subprocess
import time

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


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
            wait = WebDriverWait(driver, 210)
            try:
                wait.until(lambda d: d.find_element(By.ID, "engineBadge").text == "STARS ready")
                wait.until(lambda d: "arrivals" in d.find_element(By.ID, "statusText").text.lower())
            except TimeoutException:
                print("BADGE:", driver.find_element(By.ID, "engineBadge").text)
                print("STATUS:", driver.find_element(By.ID, "statusText").text)
                print("BROWSER LOG:")
                for entry in driver.get_log("browser"):
                    print(entry)
                raise
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
