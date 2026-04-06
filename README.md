# 🚦 RoadEnforce AU — Road Safety Enforcement Analysis

**RoadEnforce AU** is an interactive, web-based data visualization dashboard investigating 16 years of road safety enforcement data across Australian jurisdictions. It explores testing volumes, positivity rates, and public safety outcomes to answer the critical question: *Does cracking down on road safety actually work?*

This project was developed as part of **COS30045 Data Visualisation** at Swinburne University Vietnam.

Access the website at: [https://mercury.swin.edu.au/cos30045/s104311214/RoadEnforceAU/](https://mercury.swin.edu.au/cos30045/s104311214/RoadEnforceAU/ "https://mercury.swin.edu.au/cos30045/s104311214/RoadEnforceAU/")

Or [https://mysterioususerx.github.io/COS30045-Data-Visualisation-Project/](https://mysterioususerx.github.io/COS30045-Data-Visualisation-Project/ "https://mysterioususerx.github.io/COS30045-Data-Visualisation-Project/")

## 📊 Project Overview

The dashboard translates complex state-level enforcement data into accessible, interactive data narratives using modern web technologies and D3.js. It allows users to filter, compare, and analyze historical data from the Bureau of Infrastructure and Transport Research Economics (BITRE) to understand how policing effort correlates with infringement impact.

## 🚀 Features & Visualizations

The dashboard is structured into four primary analytical narratives:

1.  **Enforcement Intensity (Choropleth Map & Linked Bar Chart)**
    -   Visualizes the geographical distribution of breath and drug tests.
    -   Highlights the patchwork of enforcement priorities and resourcing across different states.
2.  **Effort vs. Impact (Dual-Axis Chart)**
    -   Correlates the volume of tests conducted against the resulting offenses over time.
    -   Investigates whether increasing enforcement effort yields a proportionate impact on deterrence.
3.  **State Comparison (Slope Chart & Scatter Plot)**
    -   Compares the performance and testing strategies of different jurisdictions.
    -   Highlights shifts in alcohol and drug positivity rates over a 16-year period.
4.  **Fine Composition (Stacked Area Chart & Small Multiples)**
    -   Breaks down the composition of enforcement fines across multiple infringement categories.
    -   Demonstrates how policing priorities and offender behavior have shifted over time.

## 🛠️ Tech Stack

-   **Frontend:** HTML5, CSS3 (Custom variables, Flexbox, Grid)
-   **Data Visualization Libary:** [D3.js (v7)](https://d3js.org/)
-   **Data Source:** Bureau of Infrastructure and Transport Research Economics (BITRE), Police Enforcement Dataset
-   **Architecture:** Modular ES6 JavaScript structure, Component-based chart rendering

## 💻 Getting Started

This is a static web application. To run it locally:

1.  Clone the repository:`ash git clone https://github.com/yourusername/RoadEnforce-AU.git`
2.  Navigate to the project directory:`ash cd RoadEnforce-AU`
3.  Run a local development server. If you use VS Code, the **Live Server** extension is recommended. Alternatively, using Python:`ash python -m http.server 8000`
4.  Open your browser and navigate to [http://localhost:8000](http://localhost:8000).

## 📈 Learning Outcomes

-   Processed and cleaned sparse, long-term government datasets for web integration.
-   Designed complex, interactive, and responsive linked D3.js visualizations.
-   Applied UI/UX principles to guide users through a structured data narrative.
-   Managed state and dynamic filtering across multiple visualization components seamlessly.

## 📝 License & Credits

-   **Author:** Duc Tam Nguyen
-   **Data:** Supplied by the Bureau of Infrastructure and Transport Research Economics (BITRE)
-   **Institution:** Swinburne University Vietnam